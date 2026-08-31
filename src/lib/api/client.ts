/**
 * MirachClient — 与 Agent 引擎通信的客户端抽象
 *
 * 两种实现：
 * - MockClient（VITE_MOCK=1，默认）：本地演示数据，不发起任何网络请求
 * - RealClient（VITE_MOCK=0）：经 Tauri Relay（relay.rs）转发到引擎，
 *   引擎地址为 lib.rs 配置的 engine_base（默认 http://127.0.0.1:8787，
 *   即 constants.ts 的 API_BASE 预留端口）
 *
 * 通过 getApi()（adapter.ts）获取单例；接真实后端时前端各 store
 * 改为调用本客户端并消费事件（映射表见 docs/api-contract.md）。
 */

import type {
  AcpStatus,
  AuthStatus,
  CommandResult,
  CronJob,
  MirachEvent,
  ModelOption,
  SessionHistoryMessage,
  SessionHit,
  SessionSummary,
  SkillSummary,
} from "./types";

export interface MirachClient {
  readonly mode: "mock" | "real";
  /** 探活：引擎是否可达（网关状态点用） */
  ping(): Promise<boolean>;
  listSessions(): Promise<SessionSummary[]>;
  createSession(): Promise<SessionSummary>;
  /** 会话全文搜索（真实模式走 sessions.db FTS5） */
  searchSessions(query: string, limit?: number): Promise<SessionHit[]>;
  /** 打开会话：取历史消息 */
  loadSession(sessionId: string): Promise<SessionHistoryMessage[]>;
  /** 重命名会话（真实模式写引擎 sessions.db） */
  renameSession(sessionId: string, title: string): Promise<void>;
  /** 删除会话（真实模式删引擎 sessions.db + 快照） */
  deleteSession(sessionId: string): Promise<void>;
  submitPrompt(sessionId: string, text: string): Promise<void>;
  /** 流式提交：事件经 onEvent 逐条回调（message.delta / message.complete / message.error …）；
   *  options.reasoningEffort 随请求下发（低/中/高，对齐引擎 reasoning_effort） */
  submitPromptStream(
    sessionId: string,
    text: string,
    onEvent: (e: MirachEvent) => void,
    options?: { reasoningEffort?: string },
  ): Promise<void>;
  getModels(): Promise<ModelOption[]>;
  /** dsh 引擎模型目录（sidecar catalog：内置 deepseek + 设置页配置的提供商） */
  getDSHModels(): Promise<ModelOption[]>;
  listSkills(): Promise<SkillSummary[]>;
  /** 技能正文（详情区预览；真实模式走 RPC skills.get） */
  getSkill(name: string): Promise<{ name: string; category?: string; description?: string; content: string } | null>;
  /** 删除/归档技能（真实模式走 RPC skills.delete；受保护技能由引擎拒绝） */
  deleteSkill(name: string): Promise<boolean>;
  /** 任务列表（真实模式接 api_server /api/jobs；引擎不可达时抛错） */
  listCronJobs(): Promise<CronJob[]>;
  /** cron 操作（真实模式写 api_server；mock 为无操作，本地状态由 store 维护） */
  createCron(payload: Record<string, unknown>): Promise<void>;
  updateCron(id: string, payload: Record<string, unknown>): Promise<void>;
  deleteCron(id: string): Promise<void>;
  pauseCron(id: string): Promise<void>;
  resumeCron(id: string): Promise<void>;
  runCron(id: string): Promise<void>;
  /** 执行引擎斜杠命令（/usage /stop /queue …；真实模式 POST /v1/commands） */
  runCommand(sessionId: string, command: string): Promise<CommandResult>;
  /** ACP 边车可用性（thinking/tool 流式；真实模式探测并启动） */
  acpAvailable(): Promise<AcpStatus>;
  /** 强制刷新 ACP 探测缓存（连接设置保存后调用） */
  acpRefresh(): void;
  /** ACP 转向（/steer，运行中真打断注入纠偏） */
  steer(guidance: string): Promise<void>;
  /** 引擎认证状态（GET /auth/status；引擎不可达返回 null） */
  getAuthStatus(): Promise<AuthStatus | null>;
  /** 消息反馈上报（dsh messageFeedback.put；messageId 用引擎 assistant 消息 id） */
  sendMessageFeedback(messageId: string, rating: "positive" | "negative"): Promise<boolean>;
  /** 社区插件清单（dsh-plugins 目录扫描 + 激活状态） */
  listCommunityPlugins(): Promise<InstalledPluginInfo[]>;
  /** 安装社区插件（npm → junction → patch；返回步骤日志，重启应用后生效） */
  installCommunityPlugin(name: string): Promise<string[]>;
  /** 卸载社区插件（返回步骤日志，重启应用后生效） */
  uninstallCommunityPlugin(name: string): Promise<string[]>;
  /** 绑定酒馆预设到空白会话（agentPresets.select：世界书/记忆/关系网/剧情选项随挂载激活）。
   *  会话已有回合时引擎拒绝（locked）→ 返回 false；成功返回 true。 */
  selectAgentPreset(sessionId: string, presetId: string): Promise<boolean>;
  /** 引擎插件清单（sidecar 生成 cordis.yml 的装配镜像，config.pluginEntries） */
  listEnginePlugins(): Promise<{ id: string; name: string }[]>;
  /** 订阅服务端事件流；返回取消订阅函数 */
  subscribe(onEvent: (e: MirachEvent) => void): () => void;
}

// ================================================================
// Mock 实现（VITE_MOCK=1：演示数据）
// ================================================================

/** 社区插件（dsh-plugins 目录里已安装的包） */
export interface InstalledPluginInfo {
  name: string;
  version: string;
  description: string;
  /** package.json 声明 dsh 字段 = 插件包 */
  isPlugin: boolean;
  /** profile cordis.patch.yml 已激活 */
  active: boolean;
  /** junction 已建（profile node_modules 可解析） */
  linked: boolean;
  /** mirach 内置三件（UI 禁用卸载） */
  builtin: boolean;
}

class MockClient implements MirachClient {
  readonly mode = "mock" as const;
  private listeners = new Set<(e: MirachEvent) => void>();

  async listEnginePlugins(): Promise<{ id: string; name: string }[]> {
    return [];
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [
      { id: "s1", title: "前端架构重构方案", createdAt: Date.now() - 3600_000, updatedAt: Date.now() },
      { id: "s2", title: "API 接口设计评审", createdAt: Date.now() - 7200_000, updatedAt: Date.now() },
    ];
  }

  async createSession(): Promise<SessionSummary> {
    return { id: `s${Date.now()}`, title: "新会话", createdAt: Date.now(), updatedAt: Date.now() };
  }

  async searchSessions(query: string): Promise<SessionHit[]> {
    return [
      {
        sessionId: "s1",
        title: "前端架构重构方案",
        role: "assistant",
        snippet: `<mark>${query}</mark> 相关的架构决策记录…`,
        messageId: 1,
      },
    ];
  }

  async loadSession(sessionId: string): Promise<SessionHistoryMessage[]> {
    return [
      { id: 1, role: "user", content: `（mock）会话 ${sessionId} 的历史用户消息` },
      { id: 2, role: "assistant", content: "（mock）历史回复内容" },
    ];
  }

  async renameSession(_sessionId: string, _title: string): Promise<void> {
    /* mock：无操作 */
  }

  async deleteSession(_sessionId: string): Promise<void> {
    /* mock：无操作 */
  }

  async submitPrompt(_sessionId: string, _text: string): Promise<void> {
    /* mock：非流式提交无订阅者可演示，静默（旧实现广播孤儿 delta 且无
       complete 收尾，一旦有订阅方会把 $aiStreaming 永久卡在 true） */
  }

  async submitPromptStream(
    _sessionId: string,
    _text: string,
    onEvent: (e: MirachEvent) => void,
    _options?: { reasoningEffort?: string },
  ): Promise<void> {
    // mock：300ms 后发一条 delta + complete，演示流式事件形状
    window.setTimeout(() => {
      const id = `m${Date.now()}`;
      onEvent({
        type: "message.delta",
        sessionId: _sessionId,
        messageId: id,
        partType: "text",
        delta: "（mock 流式响应）已收到你的消息，接真实后端后这里会逐块流式返回。",
      });
      onEvent({ type: "message.complete", sessionId: _sessionId, messageId: id });
    }, 300);
  }

  async getModels(): Promise<ModelOption[]> {
    // 对齐 dsh deepseek-official 官方目录（llm-deepseek DEFAULT_MODELS）
    return [
      { id: "deepseek-v4-flash", provider: "DeepSeek", label: "DeepSeek-V4-Flash" },
      { id: "deepseek-v4-pro", provider: "DeepSeek", label: "DeepSeek-V4-Pro" },
    ];
  }

  async getDSHModels(): Promise<ModelOption[]> {
    // mock：与 getModels 一致（dsh 内置目录），输入框目录真实化用
    return this.getModels();
  }

  async listSkills(): Promise<SkillSummary[]> {
    return [
      { id: "terminal", name: "终端执行", enabled: true, usage: 24 },
      { id: "file-edit", name: "文件编辑", enabled: true, usage: 18 },
      { id: "web-search", name: "网页搜索", enabled: false, usage: 6 },
    ];
  }

  async getSkill(_name: string): Promise<{ name: string; category?: string; description?: string; content: string } | null> {
    return { name: _name, category: "coding", description: "（mock）技能演示正文。", content: `# ${_name}\n\n（mock 内容）接入引擎后这里返回 SKILL.md 全文。` };
  }

  async deleteSkill(_name: string): Promise<boolean> {
    return true; // mock：本地过滤即可
  }

  async listCronJobs(): Promise<CronJob[]> {
    return [
      { id: "c1", name: "每日报告", schedule: "0 9 * * *", enabled: true, lastRunAt: Date.now() - 86400_000, nextRunAt: Date.now() + 3600_000 },
    ];
  }

  async createCron(_payload: Record<string, unknown>): Promise<void> {
    /* mock：由 store 本地维护 */
  }

  async updateCron(_id: string, _payload: Record<string, unknown>): Promise<void> {
    /* mock */
  }

  async deleteCron(_id: string): Promise<void> {
    /* mock */
  }

  async pauseCron(_id: string): Promise<void> {
    /* mock */
  }

  async resumeCron(_id: string): Promise<void> {
    /* mock */
  }

  async runCron(_id: string): Promise<void> {
    /* mock */
  }

  async runCommand(_sessionId: string, command: string): Promise<CommandResult> {
    const cmd = command.startsWith("/") ? command : `/${command}`;
    return { accepted: true, output: `（mock）已执行 ${cmd}，接入引擎后这里会返回真实输出。` };
  }

  async acpAvailable(): Promise<AcpStatus> {
    return { available: true, reason: null, version: "0.22.0 (mock)" };
  }

  acpRefresh(): void {
    /* mock：无缓存 */
  }

  async steer(_guidance: string): Promise<void> {
    /* mock：无操作 */
  }

  async getAuthStatus(): Promise<AuthStatus | null> {
    return {
      status: "ok",
      mode: "bearer",
      configured: true,
      authenticated: true,
      identity: "demo@mirach.local",
    };
  }

  async sendMessageFeedback(_messageId: string, _rating: "positive" | "negative"): Promise<boolean> {
    return true; // mock：本地赞踩即可
  }

  async selectAgentPreset(_sessionId: string, _presetId: string): Promise<boolean> {
    return false; // mock 无引擎预设
  }

  async listCommunityPlugins(): Promise<InstalledPluginInfo[]> {
    return []; // mock 无插件目录
  }

  async installCommunityPlugin(_name: string): Promise<string[]> {
    return ["（mock）无需安装"];
  }

  async uninstallCommunityPlugin(_name: string): Promise<string[]> {
    return ["（mock）无需卸载"];
  }

  subscribe(onEvent: (e: MirachEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }
}

// ================================================================
// 真实实现（VITE_MOCK=0：经 Tauri Relay → 引擎）
// 前端不直接请求引擎，而是走 Rust 侧 relay 命令（relay.rs），
// 保持 UI → Relay → 引擎 三层架构；换引擎只改 Relay 适配端。
// ================================================================

import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

class RealClient implements MirachClient {
  readonly mode = "real" as const;
  private listeners = new Set<(e: MirachEvent) => void>();
  private unlisten: (() => void) | null = null;
  /** Tauri listen 注册中标记：resolve 前的并发订阅不得重复发起 listen */
  private unlistenPromise: Promise<unknown> | null = null;
  /** ACP 可用性缓存（探测一次；不可用时自动降级 8787 整段） */
  private acpCache: AcpStatus | null = null;
  /** ACP 探测时间戳：缓存 TTL 10s，避免 ACP 边车后续启动后前端永久拿着失败结果 */
  private acpCachedAt = 0;
  private static readonly ACP_TTL = 10_000;

  /** 强制刷新 ACP 探测（连接设置保存后调用，丢旧缓存） */
  acpRefresh(): void {
    this.acpCache = null;
    this.acpCachedAt = 0;
  }

  async ping(): Promise<boolean> {
    try {
      const st = await invoke<{ ok: boolean }>("relay_ping");
      return st.ok === true;
    } catch {
      return false;
    }
  }

  async acpAvailable(): Promise<AcpStatus> {
    if (this.acpCache && Date.now() - this.acpCachedAt < RealClient.ACP_TTL) return this.acpCache;
    try {
      const st = await invoke<AcpStatus>("acp_status");
      this.acpCache = st;
      this.acpCachedAt = Date.now();
      return st;
    } catch {
      this.acpCache = { available: false, reason: "ACP 调用失败" };
      this.acpCachedAt = Date.now();
      return this.acpCache;
    }
  }

  async steer(guidance: string): Promise<void> {
    // dsh 引擎转向（steer_prompt → sidecar → 运行时插话纠偏）
    if (!guidance.trim()) return;
    try {
      await invoke("steer_prompt", { text: guidance });
    } catch {
      /* 引擎不可达忽略 */
    }
  }

  // 引擎会话列表：ACP 优先（真实会话），不可用降级直读 sessions.db
  async listSessions(): Promise<SessionSummary[]> {
    const st = await this.acpAvailable();
    if (st.available) {
      try {
        const raw = await invoke<unknown>("acp_sessions_list");
        const list = ((raw as { sessions?: unknown[] } | null)?.sessions ?? []) as Record<string, unknown>[];
        const mapped = list.map((o) => ({
          id: String(o.sessionId ?? o.session_id ?? ""),
          title: String(o.title ?? "未命名会话"),
          createdAt: typeof o.createdAt === "string" ? Date.parse(o.createdAt) || 0 : 0,
          updatedAt: typeof o.updatedAt === "string" ? Date.parse(o.updatedAt) || 0 : 0,
        }));
        if (mapped.length > 0) return mapped;
      } catch {
        /* 落到本地 sessions.db */
      }
    }
    try {
      const raw = await invoke<unknown>("sessions_list");
      const list = Array.isArray(raw) ? raw : [];
      return list.map((s) => {
        const o = s as { id?: string; title?: string; createdAt?: string; updatedAt?: string };
        return {
          id: String(o.id ?? ""),
          title: String(o.title ?? "未命名会话"),
          createdAt: typeof o.createdAt === "string" ? Date.parse(o.createdAt) || 0 : 0,
          updatedAt: typeof o.updatedAt === "string" ? Date.parse(o.updatedAt) || 0 : 0,
        };
      });
    } catch {
      return [];
    }
  }

  async searchSessions(query: string, limit?: number): Promise<SessionHit[]> {
    try {
      return await invoke<SessionHit[]>("sessions_search", { query, limit: limit ?? 20 });
    } catch {
      return [];
    }
  }

  async loadSession(sessionId: string): Promise<SessionHistoryMessage[]> {
    try {
      return await invoke<SessionHistoryMessage[]>("sessions_load", { sessionId });
    } catch {
      return [];
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await invoke("sessions_rename", { sessionId, title });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await invoke("sessions_delete", { sessionId });
  }

  // 引擎按 session_id 隐式建会话：本地生成 id
  async createSession(): Promise<SessionSummary> {
    const id = `s${Date.now()}`;
    return { id, title: "新会话", createdAt: Date.now(), updatedAt: Date.now() };
  }

  async submitPrompt(sessionId: string, text: string): Promise<void> {
    await invoke("relay_submit", { sessionId, text, model: null, reasoningEffort: null });
  }

  async submitPromptStream(
    sessionId: string,
    text: string,
    onEvent: (e: MirachEvent) => void,
    _options?: { reasoningEffort?: string },
  ): Promise<void> {
    // dsh 引擎流式提交：经 sidecar → DeepSeek Harness（与简约档 useDSHStream 同管道），
    // pi 事件 → MirachEvent 桥接到 $liveMessages（默认/dsh 对话风格共用显示路径）。
    const { $providerConfig, activeModelIdOf } = await import("@/store/providerConfig");
    const { recordUsage } = await import("@/store/usage");
    const { addTodo, updateTodoStatus, removeTodo } = await import("@/store/todos");
    const { addSubagent, updateSubagentStatus } = await import("@/store/subagents");
    const cfg = $providerConfig.get().find((c) => activeModelIdOf(c) !== "");
    const provider = cfg?.id ?? undefined;
    const model = cfg ? activeModelIdOf(cfg) : undefined;

    const ch = new Channel<Record<string, unknown>>();
    let msgId = "";
    let acc = "";
    let started = false;
    let errorSent = false;
    /** 当前回合引擎 assistant 消息 id（message_end 携带；feedback 上报 target） */
    let pendingEngineId = "";
    ch.onmessage = (raw) => {
      const ev = raw as {
        type: string;
        message?: { role?: string; stopReason?: string; errorMessage?: string } | string;
        assistantMessageEvent?: { type?: string; delta?: string; content?: string };
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        isError?: boolean;
        code?: string;
        retryable?: boolean;
        engineMessageId?: string;
      };
      switch (ev.type) {
        case "message_start":
          // 只对 assistant 开新气泡；user 回显已由前端 appendUserMessage 渲染
          if (typeof ev.message === "object" && ev.message?.role === "assistant" && !started) {
            started = true;
            errorSent = false;
            acc = "";
            msgId = `m${Date.now()}`;
            onEvent({ type: "message.start", sessionId, messageId: msgId });
          }
          break;
        case "message_update": {
          const ame = ev.assistantMessageEvent;
          if (ame?.type === "text_delta" && started) {
            acc += ame.delta ?? "";
            onEvent({ type: "message.delta", sessionId, messageId: msgId, partType: "text", delta: ame.delta ?? "" });
          } else if (ame?.type === "text_end" && started) {
            acc = ame.content ?? acc;
          } else if (ame?.type === "thinking_delta" && started) {
            onEvent({ type: "message.delta", sessionId, messageId: msgId, partType: "thinking", delta: ame.delta ?? "" });
          }
          break;
        }
        case "tool_execution_start": {
          const args = (ev.args ?? {}) as Record<string, unknown>;
          onEvent({
            type: "tool.start",
            sessionId,
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: String(ev.toolName ?? "tool"),
              status: "running",
              detail: JSON.stringify(ev.args ?? {}),
              args,
            },
          });
          // dsh todo 工具 → 真实待办 store
          if (ev.toolName === "todo") {
            const action = String(args.action ?? args.operation ?? "add");
            const content = typeof args.content === "string" ? args.content : typeof args.text === "string" ? args.text : "";
            const tid = typeof args.id === "string" ? args.id : typeof args.todoId === "string" ? String(args.todoId) : content;
            if (action === "complete") updateTodoStatus(tid, "completed");
            else if (action === "remove" || action === "delete") removeTodo(tid);
            else if (content) addTodo(content);
          }
          break;
        }
        case "tool_execution_end": {
          // 把工具结果文本带出来（dsh ToolRow OUT 卡）
          const res = (ev as { result?: { content?: { type?: string; text?: string }[] } }).result;
          const resultText = (res?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          onEvent({
            type: "tool.complete",
            sessionId,
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: "",
              status: ev.isError ? "error" : "completed",
              ...(resultText ? { result: resultText } : {}),
            },
          });
          break;
        }
        case "message_end":
          if (typeof ev.engineMessageId === "string" && ev.engineMessageId) {
            pendingEngineId = ev.engineMessageId;
          }
          if (typeof ev.message === "object" && ev.message?.stopReason === "error" && !errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId,
              messageId: msgId,
              message: String(ev.message.errorMessage ?? "引擎错误"),
            });
            started = false;
          }
          break;
        case "error":
          if (!errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId,
              messageId: msgId,
              code: String(ev.code ?? ""),
              retryable: Boolean(ev.retryable),
              message: typeof ev.message === "string" ? ev.message : String(ev.code ?? "引擎错误"),
            });
            started = false;
          }
          break;
        case "agent_end":
        case "done":
          if (started) {
            onEvent({
              type: "message.complete",
              sessionId,
              messageId: msgId,
              text: acc,
              ...(pendingEngineId ? { engineMessageId: pendingEngineId } : {}),
            });
            started = false;
          }
          pendingEngineId = "";
          break;
        case "usage":
          // token 计量 → 使用统计 store
          recordUsage(
            (ev as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; reasoningTokens?: number } }).usage ?? {},
          );
          break;
        case "subagent.started": {
          const p = (ev as unknown as { params?: Record<string, unknown> }).params ?? {};
          addSubagent(
            p.name ? String(p.name) : String(p.childSessionId ?? "subagent"),
            p.goal ? String(p.goal) : "",
            p.model ? String(p.model) : "",
            p.childSessionId ? String(p.childSessionId) : undefined,
          );
          break;
        }
        case "subagent.finished": {
          const p = (ev as unknown as { params?: Record<string, unknown> }).params ?? {};
          const id = String(p.childSessionId ?? "");
          if (id) updateSubagentStatus(id, "completed");
          break;
        }
        case "compaction_summary": {
          const p = (ev as { payload?: { count?: number; tokens?: number; summary?: string } }).payload;
          onEvent({
            type: "compaction.summary",
            sessionId,
            info: {
              count: typeof p?.count === "number" ? p.count : 0,
              tokens: typeof p?.tokens === "number" ? p.tokens : 0,
              ...(p?.summary ? { summary: p.summary } : {}),
            },
          });
          break;
        }
        case "user_question": {
          // 引擎 ask_user_question → 提问卡（前端渲染 + 回答经 question/resolve 回传）
          const p = (ev as { params?: { rpcId?: string; questions?: unknown[] } }).params ?? {};
          const questions = Array.isArray(p.questions)
            ? (p.questions as {
                id?: string;
                question?: string;
                detail?: string;
                header?: string;
                options?: { label?: string; description?: string }[];
                multiSelect?: boolean;
              }[]).map((q) => ({
                id: String(q.id ?? ""),
                question: String(q.question ?? ""),
                ...(q.detail ? { detail: q.detail } : {}),
                ...(q.header ? { header: q.header } : {}),
                ...(Array.isArray(q.options) && q.options.length > 0
                  ? {
                      options: q.options.map((o) => ({
                        label: String(o.label ?? ""),
                        ...(o.description ? { description: o.description } : {}),
                      })),
                    }
                  : {}),
                ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
              }))
            : [];
          if (p.rpcId && questions.length > 0) {
            onEvent({
              type: "user_question",
              sessionId,
              rpcId: p.rpcId,
              // 与 zosma 桥同标准：无 id/question 的畸形条目与空 label 选项一律滤掉，
              // 否则会弹出空白提问卡且无法作答
              questions: questions.filter((q) => q.id && q.question).map((q) => ({
                ...q,
                ...(q.options ? { options: q.options.filter((o) => o.label) } : {}),
              })),
            });
          }
          break;
        }
      }
    };
    try {
      await invoke("send_prompt", { text, ch, provider, model });
    } catch (err) {
      onEvent({ type: "message.error", sessionId, message: String(err) });
    }
  }

  async getModels(): Promise<ModelOption[]> {
    try {
      const raw = await invoke<unknown>("relay_models");
      // 兼容 {data:[...]}（OpenAI 风格）与裸数组两种返回
      const list = Array.isArray(raw) ? raw : ((raw as { data?: unknown[] })?.data ?? []);
      return list.map((m) => {
        const o = m as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          provider: String(o.provider ?? o.owned_by ?? "engine"),
          label: String(o.label ?? o.name ?? o.id ?? ""),
        };
      });
    } catch {
      return [];
    }
  }

  /** dsh 引擎模型目录（sidecar catalog()：内置 deepseek + 设置页配置的提供商） */
  async getDSHModels(): Promise<ModelOption[]> {
    try {
      const raw = await invoke<unknown>("get_models");
      const list = Array.isArray(raw) ? raw : [];
      return list.map((m) => {
        const o = m as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          provider: String(o.provider ?? "deepseek"),
          label: String(o.name ?? o.id ?? ""),
        };
      });
    } catch {
      return [];
    }
  }

  /** 引擎插件清单（sidecar 生成 cordis.yml 的装配镜像，config.pluginEntries 走 stdin 通道） */
  async listEnginePlugins(): Promise<{ id: string; name: string }[]> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "config.pluginEntries", params: null });
      const entries = ((raw as { entries?: unknown[] } | null)?.entries ?? []) as { id: string; name: string }[];
      return entries
        .filter((e) => e && typeof e.id === "string")
        .map((e) => ({ id: String(e.id), name: String(e.name ?? "") }));
    } catch {
      return [];
    }
  }

  /** 社区插件清单（dsh-plugins 目录扫描 + 激活状态） */
  async listCommunityPlugins(): Promise<InstalledPluginInfo[]> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.list", params: null });
      return ((raw as { plugins?: InstalledPluginInfo[] } | null)?.plugins ?? []).filter((p) => p && p.name);
    } catch {
      return [];
    }
  }

  /** 安装社区插件（npm 装 dsh-plugins → junction → patch 追加；返回步骤日志） */
  async installCommunityPlugin(name: string): Promise<string[]> {
    const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.install", params: { name } });
    return ((raw as { logs?: string[] } | null)?.logs ?? []).map(String);
  }

  /** 卸载社区插件（patch 移除 → junction 删除 → npm uninstall；返回步骤日志） */
  async uninstallCommunityPlugin(name: string): Promise<string[]> {
    const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.uninstall", params: { name } });
    return ((raw as { logs?: string[] } | null)?.logs ?? []).map(String);
  }

  // 技能目录：引擎 RPC skills.list（~/.hermes/skills 递归扫描 + usage 记录）；不可达时返回空
  async listSkills(): Promise<SkillSummary[]> {
    try {
      const raw = await invoke<unknown>("relay_rpc", { method: "skills.list", params: null });
      const skills = ((raw as { result?: { skills?: unknown[] } } | null)?.result?.skills) ?? [];
      return skills.map((s) => {
        const o = s as Record<string, unknown>;
        const name = String(o.name ?? "");
        return {
          id: name,
          name: String(o.name ?? ""),
          category: o.category ? String(o.category) : undefined,
          description: o.description ? String(o.description) : undefined,
          enabled: String(o.state ?? "active") !== "archived",
          usage: typeof o.usage === "number" ? o.usage : 0,
          state: o.state ? String(o.state) : "active",
          agentCreated: Boolean(o.agent_created),
        };
      });
    } catch {
      return [];
    }
  }

  async getSkill(name: string): Promise<{ name: string; category?: string; description?: string; content: string } | null> {
    try {
      const raw = await invoke<unknown>("relay_rpc", { method: "skills.get", params: { name } });
      const res = (raw as { result?: Record<string, unknown> } | null)?.result;
      if (!res || typeof res.name !== "string") return null;
      return {
        name: String(res.name),
        category: res.category ? String(res.category) : undefined,
        description: res.description ? String(res.description) : undefined,
        content: String(res.content ?? ""),
      };
    } catch {
      return null;
    }
  }

  async deleteSkill(name: string): Promise<boolean> {
    try {
      const raw = await invoke<unknown>("relay_rpc", { method: "skills.delete", params: { name } });
      return Boolean((raw as { result?: { deleted?: unknown } } | null)?.result?.deleted);
    } catch {
      return false;
    }
  }

  // api_server /api/jobs：引擎不可达（网络/认证失败）时抛错，调用方降级
  async listCronJobs(): Promise<CronJob[]> {
    const raw = await invoke<unknown>("relay_cron_list");
    const jobs = ((raw as { jobs?: unknown[] } | null)?.jobs ?? []) as CronJob[];
    return jobs;
  }

  async createCron(payload: Record<string, unknown>): Promise<void> {
    await invoke("relay_cron_create", { payload });
  }

  async updateCron(id: string, payload: Record<string, unknown>): Promise<void> {
    await invoke("relay_cron_update", { jobId: id, payload });
  }

  async deleteCron(id: string): Promise<void> {
    await invoke("relay_cron_delete", { jobId: id });
  }

  async pauseCron(id: string): Promise<void> {
    await invoke("relay_cron_pause", { jobId: id });
  }

  async resumeCron(id: string): Promise<void> {
    await invoke("relay_cron_resume", { jobId: id });
  }

  async runCron(id: string): Promise<void> {
    await invoke("relay_cron_run", { jobId: id });
  }

  async runCommand(sessionId: string, command: string): Promise<CommandResult> {
    return invoke<CommandResult>("relay_command", { sessionId, command });
  }

  async getAuthStatus(): Promise<AuthStatus | null> {
    try {
      const st = await invoke<AuthStatus>("relay_auth_status");
      return st.reachable === false ? null : st;
    } catch {
      return null;
    }
  }

  /** 消息反馈上报（dsh messageFeedback.put，sidecar 通用 rpc 透传；
   *  sessionId 传前端会话 id，sidecar 映射到 dsh 会话 id） */
  async sendMessageFeedback(messageId: string, rating: "positive" | "negative"): Promise<boolean> {
    try {
      const { $activeSessionId } = await import("@/store/session");
      const res = await invoke<unknown>("dsh_rpc", {
        method: "messageFeedback.put",
        params: { sessionId: $activeSessionId.get(), messageId, rating },
      });
      return Boolean((res as { ok?: boolean } | null)?.ok);
    } catch {
      return false;
    }
  }

  /** 绑定酒馆预设到空白会话（agentPresets.select，sidecar 透传；锁定的会话返回 false） */
  async selectAgentPreset(sessionId: string, presetId: string): Promise<boolean> {
    try {
      await invoke("dsh_rpc", {
        method: "agentPresets.select",
        params: { sessionId, agentPreset: presetId },
      });
      return true;
    } catch {
      // 会话已有回合（locked）/ 预设不存在：绑定失败
      return false;
    }
  }

  subscribe(onEvent: (e: MirachEvent) => void): () => void {
    this.listeners.add(onEvent);
    if (!this.unlisten && !this.unlistenPromise) {
      // Relay 回复事件（Rust 侧 emit("relay:reply")）→ 统一 MirachEvent 流。
      // unlistenPromise 防竞态：resolve 前的并发订阅不得重复发起 Tauri listen
      this.unlistenPromise = listen<{ session_id: string; reply: string }>("relay:reply", (e) => {
        const ev: MirachEvent = {
          type: "relay.reply",
          sessionId: e.payload.session_id,
          reply: e.payload.reply,
        };
        this.listeners.forEach((l) => l(ev));
      }).then((u) => {
        this.unlisten = u;
        return u;
      });
    }
    return () => this.listeners.delete(onEvent);
  }
}

// ================================================================
// 单例出口
// ================================================================

export function createClient(mock: boolean): MirachClient {
  return mock ? new MockClient() : new RealClient();
}
