/**
 * Hermes agent-sidecar — 入口
 *
 * 一个薄中继进程：stdin 收 Tauri 命令（JSONL），stdout 回 pi 事件流。
 * 真正的 agent 是 DeepSeek Harness JSON-RPC 运行时子进程（由
 * `@deepseek-ai/dsh-sdk-client` spawn/管理），sidecar 只做：
 *   1. 消息队列（prompt / steer / follow-up 串行执行，dsh 没有原生队列）
 *   2. dsh `session.event` → pi 事件适配（adapter.ts）
 *   3. ready / result / done / error 信封
 *
 * 协议（stdin → stdout JSON 行）：
 *   in : {"type":"prompt"|"steer"|"follow_up","id","text","provider?","model?"}
 *   in : {"type":"abort","id"} | {"type":"clear_queue","id"}
 *   in : {"type":"get_models","id"} | {"type":"get_active_model","id"}
 *   in : {"type":"set_model","id","provider","model"}
 *   in : {"type":"load_session","id","sessionId"} | {"type":"list_sessions","id"}
 *   in : {"type":"sync_provider_config","id","configs":[<providerConfig>]}
 *   out: {"type":"ready","models","providers","activeModel"}
 *        {"type":"event","event":<pi事件>}
 *        {"type":"result","id","data"} | {"type":"done","id"} | {"type":"error","id","message"}
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { HarnessNotification } from "@deepseek-ai/dsh-sdk-client";

import { createDshAdapter } from "./adapter.js";
import { ensureRuntime, shutdownRuntime, sessionFor, catalog, findModel, routeFor, syncProviderConfig, setEffort, setWorkspace, setSystemPrompt, workspace, DEFAULT_MODEL, PROVIDER_ROUTE, type ActiveModel, type DshRuntimeHandle } from "./dsh.js";
import { readSessionHistory } from "./history.js";
import { log, logDebug, logError, logWarn, send } from "./protocol.js";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MessageQueue, type QueuedMessage } from "./queue.js";
import { resolveRuntimePaths } from "./runtime.js";

// ── 状态 ──────────────────────────────────────────────────────────────────

const queue = new MessageQueue({
  onUpdate: (steering, followUp) => {
    send({
      type: "event",
      event: { type: "queue_update", steering, followUp },
    });
  },
});

let activeModel: ActiveModel = { provider: "deepseek", route: PROVIDER_ROUTE, id: DEFAULT_MODEL, name: "DeepSeek-V4-Flash-0731" };
/** 当前前端会话的 dsh sessionId（Phase 5 由左栏会话映射传入）。 */
let currentSessionId: string | null = null;
/** 当前前端会话 id（load_session 设置；collision 换 id 时更新映射）。 */
let currentFrontendId: string | null = null;
/** 前端会话 id → dsh session id 映射（持久化到 sessionRoot，重启后续聊复用同一 dsh 会话）。
 *  不把 "default" 等通用前端 id 直接交给运行时：磁盘上已有旧运行时留下的
 *  同名持久化日志时，新运行时打开会报 id collision（persisted log 不匹配）。
 *  键带环境命名空间："<envId>::<frontendId>"——同一前端会话在不同环境
 *  （工作区）下各自映射独立 dsh 会话，上下文互不串。 */
const sessionMap = new Map<string, string>();
let sessionMapLoaded = false;

/** 环境隔离键：sessionMap / 反馈上报都以 "<envId>::<frontendId>" 寻址。 */
function envSessionKey(frontendId: string): string {
  return `${workspace().envId}::${frontendId}`;
}

function sessionMapFile(): string {
  return join(resolveRuntimePaths().sessionRoot, "session-map.json");
}

/** 启动时加载持久化映射（幂等；加载失败忽略，回退内存态）。
 *  旧格式（无 "::" 前缀的裸 frontendId 键）迁移为 main 环境。 */
function loadSessionMap(): void {
  if (sessionMapLoaded) return;
  sessionMapLoaded = true;
  try {
    const f = sessionMapFile();
    if (existsSync(f)) {
      const raw = JSON.parse(readFileSync(f, "utf8")) as Record<string, unknown>;
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v !== "string") continue;
        const key = k.includes("::") ? k : `main::${k}`;
        sessionMap.set(key, v);
      }
      log("session map loaded: %d entries", sessionMap.size);
    }
  } catch (err) {
    logWarn("session map load failed: %s", err instanceof Error ? err.message : String(err));
  }
}

/** 持久化映射（变更/换 id 后调用；失败静默——内存态仍可用）。 */
function saveSessionMap(): void {
  try {
    const f = sessionMapFile();
    mkdirSync(resolveRuntimePaths().sessionRoot, { recursive: true });
    writeFileSync(f, JSON.stringify(Object.fromEntries(sessionMap)), "utf8");
  } catch (err) {
    logWarn("session map save failed: %s", err instanceof Error ? err.message : String(err));
  }
}

/** 正在执行 run 的 worker（保证单飞）。 */
let runPromise: Promise<void> | null = null;

function emitEvent(evt: unknown): void {
  send({ type: "event", event: evt });
}

/** 已挂 client 级通知桥的 runtime（每个 runtime 只挂一次）。 */
const bridgedRuntimes = new WeakSet<object>();

/**
 * client 级 notification 桥：把 sdk runtime 的全局通知（当前是引擎提问
 * question/requested）转发成 pi 事件给前端。挂在 ensureRuntime 的句柄上，
 * runtime 重启后自动重新挂载（WeakSet 按实例去重）。
 */
function attachNotificationBridge(rt: DshRuntimeHandle): void {
  if (bridgedRuntimes.has(rt.harness)) return;
  bridgedRuntimes.add(rt.harness);
  void (async () => {
    const sub = rt.harness.client.subscribe();
    try {
      for (;;) {
        const n = await sub.next();
        if (n.method === "question/requested") {
          // 引擎 ask_user_question → 前端提问卡（前端经 dsh_rpc question/resolve 回答）
          emitEvent({ type: "user_question", params: n.params });
        }
      }
    } catch {
      /* runtime 关闭/重建时静默结束 */
    }
  })();
}

// ── run worker ─────────────────────────────────────────────────────────────

/** 串行执行队列里的每条消息；队列空时结束。abort 已由命令侧清空队列。 */
async function runWorker(): Promise<void> {
  while (queue.length > 0) {
    const msg = queue.peek();
    if (!msg) break;
    log("run: %s (%s) — %s", msg.kind, msg.cmdId, msg.text.slice(0, 60));
    try {
      await runOne(msg);
    } catch (err) {
      logError("run failed (%s): %s", msg.cmdId, err instanceof Error ? err.message : String(err));
      send({ type: "error", id: msg.cmdId, message: err instanceof Error ? err.message : String(err) });
      send({ type: "done", id: msg.cmdId });
    } finally {
      queue.dequeue(msg.cmdId);
    }
  }
  runPromise = null;
  // 队列空后新入队的消息继续跑（避免 worker 粘滞导致队列静默停摆）
  if (queue.length > 0) startWorker();
}

/** 跑一条消息：确保运行时就绪（按需启动），session.run 到 agent idle。 */
async function runOne(msg: QueuedMessage): Promise<void> {
  let sessionId = currentSessionId ?? `session-${randomUUID().replaceAll("-", "")}`;
  if (!currentSessionId) currentSessionId = sessionId;

  // prompt/steer/follow_up 可携带 provider/model：优先按消息指定的模型跑，
  // 否则沿用 sidecar 当前 activeModel。请求的模型不在可用目录（无凭据被过滤等）
  // 时回退 activeModel（deepseek 默认，走 env 注入的 key/端点），避免路由到
  // 无法认证的 llm-pi-ai 提供商。
  const model = msg.provider && msg.model
    ? (findModel(msg.provider, msg.model) ?? activeModel)
    : activeModel;
  if (model.id !== activeModel.id || model.provider !== activeModel.provider) {
    log("message model overrides active: %s/%s", model.provider, model.id);
    activeModel = model;
  } else if (msg.provider && msg.model && !findModel(msg.provider, msg.model)) {
    // 请求的模型不在可用目录（无凭据被过滤等）——静默回退会让用户以为还在
    // 和所选模型对话，发一条状态气泡明示
    emitEvent({
      type: "status.update",
      status: `⚠️ 模型 ${msg.provider}/${msg.model} 未配置或缺少凭据，本次由 ${activeModel.provider}/${activeModel.id} 回答`,
    });
  }

  // 在指定 dsh session 里跑当前消息；返回 false 表示需要换新会话重试（会话 id 冲突）
  const runIn = async (sid: string): Promise<boolean> => {
    const rt = await ensureRuntime(activeModel);
    attachNotificationBridge(rt);
    const session = sessionFor(rt, sid);
    // 事件信封带 runId（=cmdId）：Rust 侧按 id 只发给对应 prompt 的 channel（防多 prompt 混播）
    const emitRun = (evt: unknown) => send({ type: "event", runId: msg.cmdId, event: evt });
    const adapter = createDshAdapter({
      emit: emitRun,
      emitQueue: () => emitQueueSnapshot(),
      provider: activeModel.provider,
      model: activeModel.id,
    });

    let sawIdle = false;
    let collided = false;
    await session.run(msg.text, {
      onNotification: (n: HarnessNotification) => {
        // 子代理生命周期（params 是 parentSessionId/childSessionId，先于 sessionId 过滤处理）
        if (n.method === "subagent.started" || n.method === "subagent.finished") {
          emitEvent({ type: n.method, params: n.params });
          return;
        }
        const params = n.params as { sessionId?: string; status?: string; event?: { type: string } & Record<string, unknown> };
        if (params?.sessionId !== sid) return;
        // 会话 id 与磁盘持久化日志冲突（id collision）：运行时以 turn/end error
        // 事件形式上报。结构化判断（替代全量 JSON.stringify 热路径开销）。
        const ev = params.event;
        if (n.method === "session.event" && ev?.type === "turn/end") {
          const reason = (ev.data as { reason?: { kind?: string; error?: { message?: string } } } | undefined)?.reason;
          if (reason?.kind === "error" && /persisted log|id collision/i.test(reason.error?.message ?? "")) {
            collided = true;
            return;
          }
        }
        if (n.method === "session.status") {
          if (params.status === "idle") sawIdle = true;
          adapter.onStatus(params.status ?? "idle");
          return;
        }
        if (n.method === "session.event" && params.event) {
          adapter.handle(params.event);
        }
      },
    });
    adapter.resetTurn();
    if (!sawIdle && !collided) {
      // run resolve 前必然收到 idle；若没有（罕见），补发结束信号防止前端卡 thinking
      emitRun({ type: "agent_end", messages: [] });
      emitRun({ type: "done" });
    }
    return !collided;
  };

  try {
    const ok = await runIn(sessionId);
    if (!ok) {
      const fresh = `dsh-${currentFrontendId ?? "session"}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      logWarn("session id collision on %s — restarting runtime, retrying with fresh id %s", sessionId, fresh);
      currentSessionId = fresh;
      sessionId = fresh;
      // 冲突后更新持久化映射（该前端会话后续用新 dsh id）
      if (currentFrontendId) {
        sessionMap.set(envSessionKey(currentFrontendId), fresh);
        saveSessionMap();
      }
      // 冲突后运行时可能已退出/不可用：重启运行时再跑新会话
      await shutdownRuntime();
      await runIn(fresh);
    }
  } catch (err) {
    const msgText = err instanceof Error ? err.message : String(err);
    // 兜底：异常形式上报的冲突同样重启运行时 + 换新 id 重试
    if (/persisted log|id collision/i.test(msgText)) {
      const fresh = `dsh-${currentFrontendId ?? "session"}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
      logWarn("session id collision (thrown) on %s — restarting runtime, retrying with fresh id %s", sessionId, fresh);
      currentSessionId = fresh;
      sessionId = fresh;
      if (currentFrontendId) {
        sessionMap.set(envSessionKey(currentFrontendId), fresh);
        saveSessionMap();
      }
      await shutdownRuntime();
      await runIn(fresh);
    } else if (/transport closed|not running|runtime is not running|process exited/i.test(msgText)) {
      // runtime 子进程崩溃/不可用（OOM/被误杀等）：重启运行时并在同一会话重试一次
      logWarn("runtime unavailable (%s) — restarting and retrying once", msgText.slice(0, 120));
      await shutdownRuntime().catch(() => {});
      await runIn(sessionId);
    } else {
      throw err;
    }
  }
  send({ type: "done", id: msg.cmdId });
  log("run: done (%s)", msg.cmdId);
}

function emitQueueSnapshot(): void {
  const { steering, followUp } = queue.snapshot();
  send({ type: "event", event: { type: "queue_update", steering, followUp } });
}

// ── 命令处理 ───────────────────────────────────────────────────────────────

interface InboundCommand {
  type: string;
  id?: string;
  text?: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  /** load_session 可选：直接采纳指定 dsh 会话 id（打开磁盘历史，不新建） */
  dshSessionId?: string;
  configs?: unknown[];
  effort?: string;
  /** set_env：环境 id + 工作区目录（环境隔离） */
  envId?: string;
  cwd?: string;
  /** set_env：主聊天 persona（agent-spine 的 system prompt） */
  systemPrompt?: string;
}

async function handleCommand(cmd: InboundCommand): Promise<void> {
  const id = cmd.id ?? randomUUID();
  switch (cmd.type) {
    case "prompt":
    case "steer":
    case "follow_up": {
      const text = (cmd.text ?? "").trim();
      if (!text) {
        send({ type: "error", id, message: "Missing 'text' field" });
        return;
      }
      queue.enqueue({ kind: cmd.type, text, cmdId: id, provider: cmd.provider, model: cmd.model });
      // 入队成功立即回包（前端 steer/follow_up 用 scmd_r 等 result）
      send({ type: "result", id, data: { accepted: true, command: cmd.type } });
      startWorker();
      return;
    }
    case "abort": {
      // 丢弃排队项并逐个补发 error/done（前端气泡需要收尾，避免永久转圈 +
      // 后端 pending 表泄漏）；当前正在执行的 turn 引擎无 abort RPC，仍会跑完
      while (queue.length > 0) {
        const m = queue.peek();
        if (!m) break;
        queue.dequeue(m.cmdId);
        send({ type: "error", id: m.cmdId, message: "aborted by user" });
        send({ type: "done", id: m.cmdId });
      }
      send({ type: "result", id, data: { accepted: true, command: "abort" } });
      log("abort: requested (runtime 无 abort RPC，后台继续跑完当前 turn)");
      return;
    }
    case "clear_queue": {
      const drained = queue.drain();
      // drain 收回 steer/follow_up 给前端编辑；prompt 类条目没有去处，
      // 补发收尾信封防止对应气泡永久转圈
      for (const d of drained.dropped) {
        send({ type: "error", id: d.cmdId, message: "queue cleared by user" });
        send({ type: "done", id: d.cmdId });
      }
      send({ type: "result", id, data: { command: "clear_queue", steering: drained.steering, followUp: drained.followUp } });
      return;
    }
    case "set_env": {
      // 环境切换（环境隔离）：只记录工作区，不立即重启 runtime——切换后下一条
      // 消息 ensureRuntime 时 diff 出差异自动换到新工作区。cwd 同时做目录创建，
      // 首次使用新环境时免手动建目录。
      const envId = (cmd.envId ?? "").trim();
      const cwd = typeof cmd.cwd === "string" ? cmd.cwd.trim() : "";
      if (!envId) {
        send({ type: "error", id, message: "Missing 'envId' field" });
        return;
      }
      if (cwd) {
        try {
          mkdirSync(cwd, { recursive: true });
        } catch (err) {
          logWarn("set_env: cwd create failed (%s): %s", cwd, err instanceof Error ? err.message : String(err));
        }
      }
      setWorkspace(envId, cwd || undefined);
      // 主聊天 persona（奎木狼/成员人设）：经 DSH_SYSTEM_PROMPT 注入引擎
      if (typeof cmd.systemPrompt === "string") setSystemPrompt(cmd.systemPrompt);
      // sessionMap 已按 "<envId>::<frontendId>" 寻址；新环境下旧映射自然 miss
      currentFrontendId = null;
      currentSessionId = null;
      send({ type: "result", id, data: { envId, cwd: workspace().cwd } });
      return;
    }
    case "prewarm": {
      // 预热运行时（切环境/换模型后由前端立即调用）：在切环境瞬间后台完成
      // 冷启动（spawn + 握手），下一条消息免付全部冷启动代价
      ensureRuntime(activeModel)
        .then((rt) => {
          log("prewarm: runtime ready (%s)", rt.model.id);
          send({ type: "result", id, data: { prewarmed: true } });
        })
        .catch((err) => {
          logWarn("prewarm failed: %s", err instanceof Error ? err.message : String(err));
          send({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
        });
      return;
    }
    case "sync_provider_config": {
      const configs = Array.isArray(cmd.configs) ? cmd.configs : [];
      syncProviderConfig(configs);
      // 配置里指定的模型若已不在目录，回退默认；目录变化同步给前端
      if (!catalog().some((m) => m.provider === activeModel.provider && m.id === activeModel.id)) {
        activeModel = { provider: "deepseek", route: PROVIDER_ROUTE, id: DEFAULT_MODEL, name: "DeepSeek-V4-Flash" };
        log("active model no longer in catalog — reset to %s", DEFAULT_MODEL);
        await shutdownRuntime();
      }
      send({
        type: "result",
        id,
        data: {
          command: "sync_provider_config",
          models: catalog(),
          activeModel: { provider: activeModel.provider, id: activeModel.id, name: activeModel.name },
        },
      });
      return;
    }
    case "get_models": {
      send({ type: "result", id, data: { models: catalog() } });
      return;
    }
    case "get_active_model": {
      send({
        type: "result",
        id,
        data: { provider: activeModel.provider, id: activeModel.id, name: activeModel.name },
      });
      return;
    }
    case "set_model": {
      const provider = cmd.provider ?? PROVIDER_ROUTE;
      const modelId = cmd.model ?? DEFAULT_MODEL;
      const model = findModel(provider, modelId) ?? activeModel;
      if (model.id !== activeModel.id || model.provider !== activeModel.provider || model.baseURL !== activeModel.baseURL) {
        activeModel = model;
        // 协议没有 set_model RPC：重启运行时让新模型在 initialize 时生效
        log("set_model: %s/%s — restarting runtime", provider, modelId);
        await shutdownRuntime();
      }
      send({ type: "result", id, data: { provider, model: modelId } });
      return;
    }
    case "load_session": {
      if (cmd.sessionId) {
        // 前端会话 id → 独立 dsh session id（键带环境命名空间）。映射持久化到
        // sessionRoot：重启/切会话【续聊】复用同一 dsh 会话（有上文）；磁盘无此
        // id 的日志时新打开，若与旧生命周期日志冲突（id collision），run 时自动
        // 换新 id 并更新映射。切环境必须先 set_env（前端 MainPanel 串行保证）。
        // cmd.dshSessionId：「所有会话」点开磁盘历史用——直接采纳该 dsh 会话 id
        // 建立映射，而不是生成新的空会话。
        loadSessionMap();
        const key = envSessionKey(cmd.sessionId);
        let dshId = sessionMap.get(key);
        if (!dshId && cmd.dshSessionId && /^[\w.-]{1,128}$/.test(cmd.dshSessionId)) {
          dshId = cmd.dshSessionId;
          sessionMap.set(key, dshId);
          saveSessionMap();
        }
        if (!dshId) {
          dshId = `dsh-${cmd.sessionId}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
          sessionMap.set(key, dshId);
          saveSessionMap();
        }
        currentFrontendId = cmd.sessionId;
        currentSessionId = dshId;
        send({ type: "result", id, data: { sessionId: cmd.sessionId, dshSessionId: dshId } });
      } else {
        send({ type: "error", id, message: "Missing 'sessionId' field" });
      }
      return;
    }
    case "list_sessions": {
      // 扫描 DSH_SESSION_ROOT 下的持久化会话（目录里含 session.jsonl*）。
      // 标题 = 日志首条 user 消息前 60 字（dsh 无独立元数据文件，标题是
      // session/title 投影，我们轻量近似）；大文件（>1.5MB）跳过解析防阻塞。
      const sessionRoot = resolveRuntimePaths().sessionRoot;
      const sessions: { id: string; createdAt: number; title?: string }[] = [];
      const walk = (dir: string, depth: number): void => {
        if (depth > 2) return;
        try {
          for (const name of readdirSync(dir, { withFileTypes: true })) {
            if (!name.isDirectory()) continue;
            const sub = join(dir, name.name);
            const zstdPath = join(sub, "session.jsonl.zstd");
            const plainPath = join(sub, "session.jsonl");
            const logPath = existsSync(zstdPath) ? zstdPath : existsSync(plainPath) ? plainPath : null;
            if (logPath) {
              let createdAt = 0;
              let title = "";
              try {
                createdAt = statSync(logPath).mtimeMs;
                if (statSync(logPath).size <= 1_500_000) {
                  const msgs = readSessionHistory(sessionRoot, name.name);
                  title = (msgs.find((m) => m.role === "user")?.text ?? "").slice(0, 60);
                }
              } catch {
                /* 单个会话解析失败不影响列表 */
              }
              sessions.push({ id: name.name, createdAt, ...(title ? { title } : {}) });
            } else {
              walk(sub, depth + 1);
            }
          }
        } catch {
          /* 忽略 */
        }
      };
      loadSessionMap();
      if (existsSync(sessionRoot)) walk(sessionRoot, 0);
      // 映射了前端会话的条目附带 frontendId + 当前环境（前端可点开续聊）
      const enriched = sessions.map((s) => {
        const hit = [...sessionMap.entries()].find(([, dsh]) => dsh === s.id);
        return { ...s, ...(hit ? { frontendId: hit[0].split("::")[1] ?? hit[0], envId: hit[0].split("::")[0] } : {}) };
      });
      send({ type: "result", id, data: { sessions: enriched } });
      return;
    }
    case "set_effort": {
      const e = typeof cmd.effort === "string" ? cmd.effort : "max";
      // 白名单校验：effort 直接改写生成 cordis.yml，非法值可造成配置注入/失效
      if (!["off", "low", "medium", "high", "max"].includes(e)) {
        send({ type: "error", id, message: `invalid effort: ${e}` });
        return;
      }
      setEffort(e);
      // 【延迟生效】不在这里 shutdownRuntime——正在流式回答时拖滑块会把回合杀掉。
      // 下一条消息 ensureRuntime 的重启键 diff 出 effort 变化后自动换 runtime。
      send({ type: "result", id, data: { effort: e } });
      return;
    }
    case "get_history": {
      // 回放指定前端会话的 dsh 历史（sessionMap 映射到 dsh id，读持久化日志）。
      // 这里必须先加载持久化映射：app 重启后 sessionMap 内存态为空，若
      // get_history 先于 load_session 到达（Rust 侧并发无序），映射查不到会
      // 误报空历史。
      loadSessionMap();
      const frontendId = cmd.sessionId;
      const dshId = frontendId ? sessionMap.get(envSessionKey(frontendId)) : undefined;
      if (!dshId) {
        send({ type: "result", id, data: { messages: [] } });
        return;
      }
      const sessionRoot = resolveRuntimePaths().sessionRoot;
      const messages = readSessionHistory(sessionRoot, dshId);
      send({ type: "result", id, data: { messages } });
      return;
    }
    case "rpc": {
      // 通用 JSON-RPC 透传（反馈上报 / 工作流 / 交付物等 runtime 服务）：
      // messageFeedback.put 的 sessionId 是前端会话 id → 按当前环境映射到 dsh 会话 id
      loadSessionMap();
      const { method, params } = cmd as { method?: string; params?: Record<string, unknown> };
      if (!method) {
        send({ type: "error", id, message: "Missing 'method' field" });
        return;
      }
      // 本地方法：session/fork（真分叉）——映射源前端会话 → dsh 源会话，
      // 引擎 ctx.sessions.fork（最近完成回合边界）产出子会话，
      // 新前端会话 id → 子 dsh 会话的映射即刻落盘
      if (method === "session/fork") {
        const p = (params ?? {}) as { sourceSessionId?: string; newSessionId?: string };
        if (typeof p.sourceSessionId !== "string" || typeof p.newSessionId !== "string") {
          send({ type: "error", id, message: "session/fork requires sourceSessionId and newSessionId" });
          return;
        }
        loadSessionMap();
        const src = sessionMap.get(envSessionKey(p.sourceSessionId));
        if (!src) {
          send({ type: "error", id, message: "源会话尚未建立引擎映射，请先在其中发送一条消息" });
          return;
        }
        const childDsh = `dsh-${p.newSessionId}-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
        const rt = await ensureRuntime(activeModel);
        try {
          const result = await rt.harness.client.request(
            "session/fork",
            { sessionId: src, childSessionId: childDsh },
            30_000,
          );
          const childEngineId = String((result as Record<string, unknown>)?.sessionId ?? childDsh);
          sessionMap.set(envSessionKey(p.newSessionId), childEngineId);
          saveSessionMap();
          currentFrontendId = p.newSessionId;
          currentSessionId = childEngineId;
          log("session/fork: %s -> %s (frontend %s)", src, childEngineId, p.newSessionId);
          send({ type: "result", id, data: { sessionId: p.newSessionId, dshSessionId: childEngineId } });
        } catch (err) {
          logError("session/fork failed: %s", err instanceof Error ? err.message : String(err));
          send({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
        }
        return;
      }
      // 本地方法：config.pluginEntries（设置页插件列表）——读生成 cordis.yml 的
      // 插件条目（引擎没有对应 RPC，这里是 sidecar 侧真实装配的镜像）
      if (method === "config.pluginEntries") {
        try {
          const yml = readFileSync(sessionMapFile().replace("session-map.json", "cordis.generated.yml"), "utf8");
          const entries: { id: string; name?: string }[] = [];
          for (const m of yml.matchAll(/-\s+id:\s*(\S+)\s*\n\s*name:\s*'?([\w@/.-]+)'?/g)) {
            entries.push({ id: m[1], name: m[2] });
          }
          send({ type: "result", id, data: { entries } });
        } catch (err) {
          logWarn("config.pluginEntries read failed: %s", err instanceof Error ? err.message : String(err));
          send({ type: "result", id, data: { entries: [] } });
        }
        return;
      }
      try {
        const rt = await ensureRuntime(activeModel);
        let callParams: Record<string, unknown> | undefined = params;
        if (method === "messageFeedback.put" && callParams && typeof callParams.sessionId === "string") {
          // 映射不到就用原值：宁可反馈落在无映射的会话上，也不能错归到
          // 另一个正打开的会话（currentSessionId 兜底已移除）
          const dshId = sessionMap.get(envSessionKey(callParams.sessionId)) ?? callParams.sessionId;
          callParams = { ...callParams, sessionId: dshId };
        }
        // 长任务（workflow.* 等）放宽超时，其余 30s
        const rpcTimeoutMs = /^workflow\./.test(method) || method.includes("workflow") ? 300_000 : 30_000;
        const result = await rt.harness.client.request(method, callParams ?? {}, rpcTimeoutMs);
        log("rpc %s ok: %j", method, (result as { ok?: unknown }) ?? null);
        send({ type: "result", id, data: result });
      } catch (err) {
        logError("rpc %s failed: %s", method, err instanceof Error ? err.message : String(err));
        send({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    default:
      send({ type: "error", id, message: `Unknown command: ${cmd.type}` });
  }
}

function startWorker(): void {
  if (runPromise) return;
  runPromise = runWorker().catch((err) => {
    logError("worker crashed: %s", err instanceof Error ? err.message : String(err));
    runPromise = null;
  });
}

// ── 启动 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("Hermes agent-sidecar starting (pid=%s)", process.pid);
  const paths = resolveRuntimePaths();
  log("harnessRoot=%s", paths.harnessRoot);

  // 运行时惰性启动（第一个 prompt 才拉起）；ready 只报配置，不预热。
  const readyModels = catalog();
  const readyProviders = new Map<string, number>();
  for (const m of readyModels) readyProviders.set(m.provider, (readyProviders.get(m.provider) ?? 0) + 1);
  send({
    type: "ready",
    models: readyModels,
    providers: [...readyProviders.entries()].map(([id, modelCount]) => ({ id, modelCount })),
    activeModel: { provider: activeModel.provider, id: activeModel.id, name: activeModel.name },
  });

  // 预热：应用启动即拉起 dsh 运行时（initialize 握手不调用 LLM，不消耗额度），
  // 让引擎进程立即可见；失败只记录，首个 prompt 仍会按需重试启动。
  ensureRuntime(activeModel).catch((err) => {
    logWarn("warm start failed (lazy retry on first prompt): %s", err instanceof Error ? err.message : String(err));
  });

  const rl = createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let cmd: InboundCommand;
    try {
      cmd = JSON.parse(line) as InboundCommand;
    } catch {
      logWarn("Invalid JSON: %s", line.slice(0, 100));
      continue;
    }
    try {
      await handleCommand(cmd);
    } catch (err) {
      logError("command error (type=%s): %s", cmd.type, err instanceof Error ? err.message : String(err));
      send({ type: "error", id: cmd.id ?? "unknown", message: err instanceof Error ? err.message : String(err) });
    }
  }

  log("Sidecar shutting down (stdin closed)");
  await shutdownRuntime();
  process.exit(0);
}

main().catch((err) => {
  logError("Fatal: %s", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
