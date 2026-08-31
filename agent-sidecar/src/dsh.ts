/**
 * Hermes agent-sidecar — dsh 运行时生命周期
 *
 * 用 `@deepseek-ai/dsh-sdk-client` 拉起 DeepSeek Harness JSON-RPC 运行时
 * 子进程，并管理 provider/model 配置。SDK 自带 initialize 握手与子进程
 * teardown（stdin EOF → SIGTERM → SIGKILL），sidecar 不直接持有 child。
 *
 * 关键设计：
 *  - 一个运行时进程服务多个 dsh session（SDK 按 sessionId 建会话）；
 *    会话切换不重启进程，只在模型/配置变化时重启（模型在 initialize 握手
 *    时固定，协议没有 set_model RPC）。
 *  - 就绪前不预热：第一个 prompt 到来时才拉起，配置错误在该时刻暴露。
 *  - 双适配器：
 *      * deepseek 模型 → llm-deepseek 插件（route `deepseek-official`，
 *        OpenAI 兼容 chat completions；自定义端点/API key 经
 *        DEEPSEEK_BASE_URL / DEEPSEEK_API_KEY env 注入，每个请求解析）。
 *      * anthropic/openai/自定义端点 → llm-pi-ai 插件（providers dict
 *        经 DSH_LLM_PROVIDERS env 注入 cordis.yml 的 `!!js` 表达式；
 *        支持 anthropic-messages / openai-completions / openai-responses
 *        协议，模型目录与 key 由 sidecar 按设置页 providerConfig 构建）。
 *  - cordis.yml 动态生成（runtime.ts）：模板 + llm-pi-ai 条目，写入
 *    sessionRoot，运行时经 DSH_CORDIS_CONFIG 指向生成文件。
 */

import { DeepSeekHarness, type HarnessSession } from "@deepseek-ai/dsh-sdk-client";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log, logDebug, logError, logWarn } from "./protocol.js";
import { resolveRuntimePaths, writeRuntimeConfig, type RuntimePaths } from "./runtime.js";

/** 设置页同步进来的完整 provider 配置（保留协议/端点/密钥/模型目录）。 */
export interface ProviderConfig {
  id?: string;
  name?: string;
  kind?: string;
  baseURL?: string;
  protocol?: string;
  apiKey?: string;
  models?: { id?: string; name?: string; contextWindow?: number; maxTokens?: number }[];
}

export interface ActiveModel {
  /** 前端 provider id（catalog 匹配键：deepseek / anthropic / 自定义 route id）。 */
  provider: string;
  /** dsh 握手 route：deepseek → deepseek-official（llm-deepseek），其余 → 自身 id（llm-pi-ai）。 */
  route: string;
  id: string;
  name: string;
  /** 自定义端点（baseURL）；缺省走插件默认。 */
  baseURL?: string;
  /** 该模型专用 API key（覆盖进程 env）。 */
  apiKey?: string;
  /** wire 协议（llm-pi-ai 的 api 字段：anthropic-messages 等）；deepseek 模型忽略。 */
  protocol?: string;
}

export interface DshRuntimeHandle {
  harness: DeepSeekHarness;
  session: HarnessSession;
  paths: RuntimePaths;
  model: ActiveModel;
  /** 上次启动注入的 providers dict（重启判断用）。 */
  providersJson: string;
  /** 启动快照（重启判断用）：推理强度 / 环境 id / 工作区 cwd。 */
  effort: string;
  envId: string;
  cwd: string;
  /** 启动快照（重启判断用）：注入的 system prompt（未覆盖为 null）。 */
  systemPrompt: string | null;
  start(): Promise<void>;
  dispose(): Promise<void>;
}

export const DEFAULT_MODEL = "deepseek-v4-flash-0731";
/** dsh llm-deepseek 插件的 provider route（initialize 握手必须用它）。 */
export const PROVIDER_ROUTE = "deepseek-official";
/** 内置 dsh 官方模型目录（与前端 ProviderConnectPanel 的 DSH_DEEPSEEK_MODELS 对齐）。 */
const BUILTIN_MODELS: ActiveModel[] = [
  { provider: "deepseek", route: PROVIDER_ROUTE, id: "deepseek-v4-flash-0731", name: "DeepSeek-V4-Flash-0731" },
  { provider: "deepseek", route: PROVIDER_ROUTE, id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro" },
];

/** 前端 provider id → dsh 握手 route。 */
export function routeFor(providerId: string): string {
  return providerId === "deepseek" || providerId === PROVIDER_ROUTE ? PROVIDER_ROUTE : providerId;
}

/** 设置页同步进来的 provider 配置（完整保留，构建目录 + providers dict）。 */
let providerConfigs: ProviderConfig[] = [];

/** 合并后的模型目录（内置 deepseek + 各 provider 配置的模型；自定义覆盖同名）。
 *  无凭据的提供商（非 deepseek，无 apiKey 且其 apiKeyEnv 未在进程 env 里设置）
 *  不注册：llm-pi-ai 路由缺 key 会直接报 DSH_PROVIDER_KEY_* 未设置。 */
export function catalog(): ActiveModel[] {
  const merged = new Map<string, ActiveModel>();
  for (const m of BUILTIN_MODELS) merged.set(`${m.provider}/${m.id}`, m);
  for (const cfg of providerConfigs) {
    const provider = cfg.id?.trim();
    if (!provider || !Array.isArray(cfg.models)) continue;
    if (provider !== "deepseek" && provider !== PROVIDER_ROUTE && !cfg.apiKey && !process.env[providerKeyEnv(provider)]) {
      logDebug("skip provider %s (no credential)", provider);
      continue;
    }
    const route = routeFor(provider);
    for (const m of cfg.models) {
      if (!m.id) continue;
      merged.set(`${provider}/${m.id}`, {
        provider,
        route,
        id: m.id,
        name: m.name ?? m.id,
        ...(cfg.baseURL ? { baseURL: cfg.baseURL } : {}),
        ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}),
        ...(cfg.protocol ? { protocol: cfg.protocol } : {}),
      });
    }
  }
  return [...merged.values()];
}

/** 某 provider 的 API key 注入用的 env 名（llm-pi-ai profile.apiKeyEnv 指向它）。 */
export function providerKeyEnv(providerId: string): string {
  return `DSH_PROVIDER_KEY_${providerId.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}`;
}

/**
 * 构建 llm-pi-ai 的 providers dict（key = route）。deepseek 走 llm-deepseek，
 * 不进 dict；其余 provider 每个一条 profile：apiKeyEnv 指向 sidecar 注入的
 * env，protocol/baseURL/models 原样携带。catalog 内置路由（anthropic/openai
 * 等）不写 api 也能用，写协议是显式走 provider.ts 的协议表，行为一致。
 */
export function piAiProviders(): Record<string, unknown> {
  const dict: Record<string, unknown> = {};
  for (const cfg of providerConfigs) {
    const provider = cfg.id?.trim();
    if (!provider || provider === "deepseek" || provider === PROVIDER_ROUTE) continue;
    // 无凭据的提供商不进 llm-pi-ai 配置（避免 DSH_PROVIDER_KEY_* 未设置报错）
    if (!cfg.apiKey && !process.env[providerKeyEnv(provider)]) continue;
    const models = (cfg.models ?? []).filter((m) => m.id).map((m) => ({
      id: m.id,
      ...(m.name ? { name: m.name } : {}),
      ...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
      ...(typeof m.maxTokens === "number" ? { maxTokens: m.maxTokens } : {}),
    }));
    const profile: Record<string, unknown> = {
      apiKeyEnv: providerKeyEnv(provider),
      displayName: cfg.name ?? provider,
      models,
    };
    if (cfg.baseURL) profile.baseURL = cfg.baseURL;
    if (cfg.protocol) profile.api = cfg.protocol;
    dict[provider] = profile;
  }
  return dict;
}

/** 各 provider 的 API key env 注入表（llm-pi-ai 按 apiKeyEnv 名读取）。 */
export function providerKeyEnvs(): Record<string, string> {
  const envs: Record<string, string> = {};
  for (const cfg of providerConfigs) {
    const provider = cfg.id?.trim();
    if (provider && provider !== "deepseek" && provider !== PROVIDER_ROUTE && cfg.apiKey) {
      envs[providerKeyEnv(provider)] = cfg.apiKey;
    }
  }
  return envs;
}

/**
 * 同步设置页的 providerConfig。configs 由 Rust 中继从 Tauri 转发；完整保留
 * （含协议/端点/密钥），模型目录与 llm-pi-ai providers dict 都由它重建。
 */
export function syncProviderConfig(configs: unknown[]): void {
  providerConfigs = (Array.isArray(configs) ? configs : []).filter(
    (c) => c && typeof c === "object",
  ) as ProviderConfig[];
  const models = catalog();
  log("synced %d providers / %d models from provider config", providerConfigs.length, models.length);
  for (const m of models) {
    logDebug("  %s/%s route=%s baseURL=%s protocol=%s", m.provider, m.id, m.route, m.baseURL ?? "(default)", m.protocol ?? "-");
  }
}

/** 按 provider/id 在合并目录里查找（找不到返回 undefined）。 */
export function findModel(provider: string, id: string): ActiveModel | undefined {
  return catalog().find((m) => m.provider === provider && m.id === id);
}

let runtime: DshRuntimeHandle | null = null;
let startPromise: Promise<DshRuntimeHandle> | null = null;

/** 当前推理强度（llm-deepseek reasoningEffort；off = 关闭思考）。
 *  默认 high 而非模板的 max：实测 max 在网关下首包延迟放大到十几秒
 *  （深思考重）；用户可在输入框滑块调回。设置后【延迟生效】。 */
let currentEffort = "high";
export function effort(): string {
  return currentEffort;
}
export function setEffort(e: string): void {
  currentEffort = e;
  log("set_effort: %s (下次启动 runtime 生效)", e);
}

/**
 * 当前工作环境（环境隔离）：envId 用于 sessionMap 的命名空间（同一前端会话
 * id 在不同环境下映射到不同 dsh 会话），cwd 是引擎 bash/fs 工具的工作区根，
 * 也是 dsh 会话持久化按目录分组的依据（sessionRoot/<cwd编码>/<sessionId>）。
 * 变更同样走 ensureRuntime 重启键：切换环境后下一条消息自动换到新工作区的
 * 运行时，历史/上下文天然隔离。
 */
let currentWorkspace: { envId: string; cwd: string | null } = { envId: "main", cwd: null };
export function workspace(): { envId: string; cwd: string | null } {
  return currentWorkspace;
}
export function setWorkspace(envId: string, cwd?: string): void {
  // ~/ 前缀展开为用户主目录（前端无法预知各机器的用户目录）
  const expand = (p: string) =>
    p.startsWith("~/") || p.startsWith("~\\")
      ? join(process.env.USERPROFILE ?? process.cwd(), p.slice(2).replace(/\//g, "\\"))
      : p;
  const next = {
    envId,
    cwd: cwd && cwd.trim() ? expand(cwd.trim()) : null as string | null,
  };
  if (next.envId === currentWorkspace.envId && next.cwd === currentWorkspace.cwd) return;
  currentWorkspace = next;
  log("set_workspace: env=%s cwd=%s (下次启动 runtime 生效)", envId, next.cwd ?? "(default)");
}

/**
 * 主聊天 persona（system prompt）：经 runtimeEnv 的 DSH_SYSTEM_PROMPT 注入引擎
 * （agent-spine 的 persona）。默认 = 奎木狼全能助理；前端设置里选中的成员
 * systemPrompt 可覆盖。变更走 ensureRuntime 重启键。
 */
let currentSystemPrompt: string | null = null;
export function systemPrompt(): string | null {
  return currentSystemPrompt;
}
export function setSystemPrompt(sp?: string): void {
  const next = sp && sp.trim() ? sp.trim() : null;
  if (next === currentSystemPrompt) return;
  currentSystemPrompt = next;
  log("set_system_prompt: %s chars (下次启动 runtime 生效)", next?.length ?? 0);
}

export function currentRuntime(): DshRuntimeHandle | null {
  return runtime;
}

/** 构建运行时 launch env（providers dict + 各 provider key + deepseek 端点）。 */
export function runtimeEnv(paths: RuntimePaths, model: ActiveModel): Record<string, string> {
  const providersJson = JSON.stringify(piAiProviders());
  return {
    ...process.env,
    DSH_CWD: paths.cwd,
    DSH_SESSION_ROOT: paths.sessionRoot,
    DSH_SYSTEM_PROMPT: systemPrompt() ?? paths.systemPrompt,
    // 运行时插件从 harness checkout 的 node_modules 解析（pnpm workspace）；
    // 社区插件目录（%USERPROFILE%\.mirach\dsh-plugins\node_modules）追加在
    // NODE_PATH 尾部——cordis loader 可加载 dsh-workgroup / dsh-realtime-voice 等
    NODE_PATH: [
      join(paths.harnessRoot, "node_modules"),
      process.env.DSH_PLUGIN_NODE_PATH ?? join(paths.sessionRoot, "..", "dsh-plugins", "node_modules"),
    ]
      .filter((p) => existsSync(p))
      .join(";"),
    // cordis.yml 的 llm-pi-ai 条目经 !!js 读这个 env
    DSH_LLM_PROVIDERS: providersJson,
    ...providerKeyEnvs(),
    // 自定义端点/API key 优先（llm-deepseek 每个请求从 env 解析）
    ...(model.baseURL ? { DEEPSEEK_BASE_URL: model.baseURL } : {}),
    ...(model.apiKey ? { DEEPSEEK_API_KEY: model.apiKey } : paths.apiKey ? { DEEPSEEK_API_KEY: paths.apiKey } : {}),
  };
}

/**
 * 确保运行时已启动（惰性）。模型、端点、密钥、providers dict、推理强度或
 * 工作环境变化时重启进程；会话变化只换 session 句柄。
 */
export async function ensureRuntime(model: ActiveModel): Promise<DshRuntimeHandle> {
  const providersJson = JSON.stringify(piAiProviders());
  const effortNow = effort();
  const ws = workspace();
  const paths = resolveRuntimePaths();
  const cwdNow = ws.cwd ?? paths.cwd;
  const same = runtime && runtime.model.provider === model.provider
    && runtime.model.id === model.id
    && runtime.model.baseURL === model.baseURL
    && runtime.model.apiKey === model.apiKey
    && runtime.providersJson === providersJson
    && runtime.effort === effortNow
    && runtime.envId === ws.envId
    && runtime.cwd === cwdNow
    && runtime.systemPrompt === (systemPrompt() ?? null);
  if (same) {
    await runtime!.start();
    return runtime!;
  }
  // 并发调用：等既有的启动/重建完成后再做差异判断（避免旧模型 runtime
  // 被并发请求误用——审查 #11）
  if (startPromise) {
    await startPromise.catch(() => {});
  }
  const sameAfterWait = runtime && runtime.model.provider === model.provider
    && runtime.model.id === model.id
    && runtime.model.baseURL === model.baseURL
    && runtime.model.apiKey === model.apiKey
    && runtime.providersJson === providersJson
    && runtime.effort === effortNow
    && runtime.envId === ws.envId
    && runtime.cwd === cwdNow
    && runtime.systemPrompt === (systemPrompt() ?? null);
  if (sameAfterWait && runtime) {
    await runtime.start();
    return runtime;
  }
  startPromise = (async () => {
    if (runtime) {
      log("model/config/env changed (%s/%s) — restarting runtime", model.provider, model.id);
      await runtime.dispose().catch(() => {});
      runtime = null;
    }
    // 动态 cordis.yml：模板 + llm-pi-ai 条目 + 推理强度；运行时经 DSH_CORDIS_CONFIG 指向生成文件。
    // profile 模式（MIRACH_PROFILE=1）跳过生成：配置由 profile cordis.patch.yml 提供（env 驱动）。
    const configPath = writeRuntimeConfig(paths, effortNow);
    log("launching dsh runtime: node=%s env=%s cwd=%s profile=%s", paths.nodeBin, ws.envId, cwdNow, paths.profileMode);
    logDebug("entry=%s config=%s sessionRoot=%s", paths.entry, configPath, paths.sessionRoot);

    // profile 模式启动参数：官方 launcher 合成 base + sdk-app + web-app 三层
    // （stdio JSON-RPC + HTTP/WS 双面）；profile 内 node_modules 负责插件解析。
    const launchArgs = paths.profileMode
      ? ["--import", "tsx", paths.entry, "--profile", process.env.MIRACH_PROFILE_NAME ?? "mirach"]
      : ["--import", "tsx", paths.entry, configPath];

    const harness = new DeepSeekHarness({
      launch: {
        command: paths.nodeBin,
        args: launchArgs,
        cwd: paths.harnessRoot,
        env: {
          ...runtimeEnv(paths, model),
          // 工作环境覆盖：cwd 决定引擎工具目录与会话持久化分组（<root>/<cwd编码>/）
          ...(ws.cwd ? { DSH_CWD: ws.cwd } : {}),
          // 老 entry+生成 yml 模式专用；profile 模式忽略（配置在 profile patch）
          ...(paths.profileMode ? {} : { DSH_CORDIS_CONFIG: configPath }),
          // profile 模式专用：Harness home 指向 mirach 数据目录（profiles/
          // sessions/storages 都住这），web 面端口由 profile patch 的
          // MIRACH_WEB_PORT 表达式读取
          ...(paths.profileMode
            ? {
                DSH_HOME: process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.cwd(), ".mirach"),
                MIRACH_WEB_PORT: process.env.MIRACH_WEB_PORT ?? "3212",
                // 手机接入：web 面监听地址（Rust 侧从配置下发；127.0.0.1 = 仅本机）
                MIRACH_WEB_HOST: process.env.MIRACH_WEB_HOST ?? "127.0.0.1",
                DSH_EFFORT: effortNow,
              }
            : {}),
        },
      },
      cwd: cwdNow,
      // 握手 route：deepseek → deepseek-official（llm-deepseek），其余 → llm-pi-ai 路由
      provider: model.route,
      model: model.id,
    });

    const h: DshRuntimeHandle = {
      harness,
      session: harness.session(`session-${cryptoRandomHex()}`),
      paths,
      model,
      providersJson,
      effort: effortNow,
      envId: ws.envId,
      cwd: cwdNow,
      systemPrompt: systemPrompt() ?? null,
      start: () => harness.start(),
      dispose: () => harness.close(),
    };
    runtime = h;
    try {
      await harness.start();
      log("runtime ready, model=%s/%s route=%s env=%s", model.provider, model.id, model.route, ws.envId);
    } catch (err) {
      logError("dsh runtime start failed: %s", err instanceof Error ? err.message : String(err));
      await harness.close().catch(() => {});
      runtime = null;
      throw err;
    }
    return h;
  })();
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

/** 取一个会话句柄（sessionId 未知时由运行时惰性创建）。 */
export function sessionFor(rt: DshRuntimeHandle, sessionId: string): HarnessSession {
  if (rt.session.id !== sessionId) {
    rt.session = rt.harness.session(sessionId);
  }
  return rt.session;
}

function cryptoRandomHex(): string {
  // 轻量随机后缀，避免与前端 sessionId 冲突
  return Math.random().toString(16).slice(2, 10);
}

/** 关闭并清空当前运行时（sidecar 退出时调用）。 */
export async function shutdownRuntime(): Promise<void> {
  if (startPromise) {
    try {
      await startPromise;
    } catch {
      // 启动失败也继续关闭
    }
  }
  if (!runtime) return;
  const r = runtime;
  runtime = null;
  try {
    await r.dispose();
    log("dsh runtime closed");
  } catch (err) {
    logWarn("dsh runtime close error: %s", err instanceof Error ? err.message : String(err));
  }
}
