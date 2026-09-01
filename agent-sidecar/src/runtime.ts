/**
 * Hermes agent-sidecar — dsh 运行时启动配置
 *
 * sidecar 本身只做中继：真正的 agent 是 DeepSeek Harness 的 JSON-RPC
 * 运行时子进程（`@deepseek-ai/dsh-sdk-client` 负责 spawn 与管理它的生命周期）。
 * 运行时依赖构建产物与 pnpm workspace 的 node_modules，因此必须从
 * harness checkout 启动（不打包进本仓库）。
 *
 * 所有路径可用环境变量覆盖（开发机默认值指向本地 checkout）。
 *
 * cordis.yml 是动态生成的：以 harness 的 jsonrpc-agent 模板为底，追加
 * `llm-pi-ai` 插件条目（providers 经 `DSH_LLM_PROVIDERS` env 注入，复用
 * 模板自身的 `!!js` 表达式机制），写入 sessionRoot，运行时用
 * `DSH_CORDIS_CONFIG` 指向生成文件。这样用户设置页配置的
 * anthropic/openai/自定义端点无需改动 harness 的静态文件即可生效。
 */

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log, logError } from "./protocol.js";

/**
 * harness checkout 候选根目录（按序探测，第一个存在的生效；DSH_HARNESS_ROOT
 * 永远最高优先）：
 *  1. `<repo>/vendor/deepseek-harness` —— 软件文件夹内的规范位置（本机是
 *     junction 指向真实 checkout，其他机器直接 clone 到这里即可）
 *  2. 当前 workspace 根（从 sidecar 目录向上探测 pnpm-workspace.yaml——
 *     开发机就是这个 checkout，避免误选旧机器残留的 D 盘拷贝）
 *  3. I:\deepseek-harness（本机旧位置，junction 缺失时兜底）
 *  4. D:\deepseek-harness-master（旧机器 checkout，仅作最后兜底）
 */
function workspaceRoot(): string {
  try {
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* 探测失败走下方静态候选 */ }
  return "";
}
const HARNESS_ROOT_CANDIDATES = [
  join(process.cwd(), "..", "vendor", "deepseek-harness"),
  join(process.cwd(), "vendor", "deepseek-harness"),
  workspaceRoot(),
  "I:\\deepseek-harness",
  "D:\\deepseek-harness-master",
].filter((p: string) => p.length > 0);
/** dsh 运行时要求 Node ≥22.23.2（node:zlib createZstdDecompress）；独立安装，不走系统 PATH。 */
const NODE_BIN_CANDIDATES = [
  process.env.DSH_NODE_BIN,
  "I:\\node-v22.23.2-win-x64\\node.exe",
  "D:\\node.exe",
].filter((p): p is string => Boolean(p));

/** 生成的 cordis.yml 文件名（sessionRoot 下，DSH_CORDIS_CONFIG 指向它）。 */
const GENERATED_CONFIG_NAME = "cordis.generated.yml";

export interface RuntimePaths {
  /** harness checkout 根（cwd 与 node_modules 解析基准）。 */
  harnessRoot: string;
  /** 运行时的 node 可执行文件。 */
  nodeBin: string;
  /** JSON-RPC 运行时入口（预构建 lib/bin.js）。 */
  entry: string;
  /** cordis.yml 配置文件（默认模板；ensureRuntime 前写生成文件覆盖）。 */
  config: string;
  /** 工作区 cwd（DSH_CWD，bash/fs 工具的默认目录）。 */
  cwd: string;
  /** dsh 会话持久化目录（JSONL，zstd 压缩）。 */
  sessionRoot: string;
  /** 系统提示词（agent-spine persona）。 */
  systemPrompt: string;
  /** 环境变量中已存在的 DEEPSEEK_API_KEY（无则不设，运行时按 MISSING_CREDENTIAL 优雅失败）。 */
  apiKey: string | null;
  /** profile 模式（官方 profile 双面形态；老 entry+生成 yml 模式为 false）。 */
  profileMode: boolean;
}

export function resolveRuntimePaths(): RuntimePaths {
  // 空串 env 视同未设置（避免 shell 残留的 DSH_HARNESS_ROOT= 遮蔽候选探测）
  const harnessRoot =
    (process.env.DSH_HARNESS_ROOT || undefined)
    ?? HARNESS_ROOT_CANDIDATES.find((p) => existsSync(p))
    ?? HARNESS_ROOT_CANDIDATES[0];
  const nodeBin = NODE_BIN_CANDIDATES.find((p) => existsSync(p)) ?? NODE_BIN_CANDIDATES[0];
  // profile 模式（MIRACH_PROFILE=1 显式开启；未显式关闭时自动判定）：
  // npm 全局 dsh CLI 存在且官方 profile 包已装配（$DSH_HOME/profiles/mirach/
  // package.json，bundles = base + sdk-app + web-app）即启用——官方 profile
  // 同时提供 stdio JSON-RPC（sdk 面）与 HTTP/WS（web 面），插件经 profile
  // node_modules 解析；老"模板+生成 yml"链路（jsonrpc-demo）仅作无 profile
  // 装配时的回退。MIRACH_PROFILE=0 可强制回退。
  const npmDsh = process.env.APPDATA ? join(process.env.APPDATA, "npm", "dsh.cmd") : "";
  const profilePackage = join(
    process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? harnessRoot, ".mirach"),
    "profiles",
    process.env.MIRACH_PROFILE_NAME ?? "mirach",
    "package.json",
  );
  const profileMode =
    process.env.MIRACH_PROFILE === "1"
    || (process.env.MIRACH_PROFILE !== "0" && existsSync(npmDsh) && existsSync(profilePackage));
  const entry = profileMode
    ? join(harnessRoot, "apps", "cli", "src", "bin.ts")
    : process.env.DSH_RUNTIME_ENTRY
      ?? join(harnessRoot, "packages", "examples", "jsonrpc-demo", "lib", "bin.js");
  const config =
    process.env.DSH_CORDIS_CONFIG ??
    join(harnessRoot, "examples", "jsonrpc-agent", "cordis.yml");
  const cwd = process.env.DSH_CWD ?? process.env.USERPROFILE ?? harnessRoot;
  // profile 模式：运行时持久化走 dshHomePath('sessions') = DSH_HOME/sessions
  // （base bundle session-persistence-jsonl 行）。sidecar 的历史读取/会话列举
  // 必须指向同一位置，否则切换会话后回放为空。
  const sessionRoot =
    process.env.DSH_SESSION_ROOT ??
    (profileMode
      ? join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? harnessRoot, ".mirach"), "sessions")
      : join(process.env.USERPROFILE ?? harnessRoot, ".mirach", "dsh-sessions"));
  // 一次性迁移：profile 模式首次运行时把旧位置的 session-map.json 带过来，
  // 保住既有前端会话 ↔ dsh 会话映射（历史日志位置差异另行处理）。
  if (profileMode) {
    try {
      const legacyRoot = join(process.env.USERPROFILE ?? harnessRoot, ".mirach", "dsh-sessions");
      const newMap = join(sessionRoot, "session-map.json");
      const legacyMap = join(legacyRoot, "session-map.json");
      if (existsSync(legacyMap) && !existsSync(newMap)) {
        mkdirSync(sessionRoot, { recursive: true });
        writeFileSync(newMap, readFileSync(legacyMap, "utf8"), "utf8");
        log("migrated session map to profile sessionRoot");
      }
    } catch {
      /* 迁移失败不阻塞 */
    }
  }

  for (const [label, p] of [
    ["runtime entry", entry],
    // profile 模式：配置由 profile 目录提供，不走 cordis.yml 模板
    ...(profileMode ? [] : ([["cordis config", config]] as const)),
    ["harness root", harnessRoot],
  ] as const) {
    if (!existsSync(p)) {
      logError(
        `dsh runtime ${label} not found: ${p} (set DSH_HARNESS_ROOT / DSH_RUNTIME_ENTRY / DSH_CORDIS_CONFIG)`,
      );
    }
  }

  return {
    harnessRoot,
    nodeBin,
    entry,
    config,
    cwd,
    sessionRoot,
    systemPrompt: process.env.DSH_SYSTEM_PROMPT ?? "You are a coding agent.",
    apiKey: process.env.DEEPSEEK_API_KEY ?? null,
    profileMode,
  };
}

/**
 * 生成运行时 cordis.yml：以模板（harness jsonrpc-agent/cordis.yml）为底，
 * 追加 llm-pi-ai 插件条目，并按当前推理强度改写 llm-deepseek 配置。
 * providers 经 `DSH_LLM_PROVIDERS` env 注入——模板自身已用
 * `!!js process.env.DSH_CWD` 表达式，cordis 启动时求值，所以配置内容无需
 * 写死在文件里，ensureRuntime 每次更新 env 即可。
 *
 * @param effort 推理强度（low/medium/high/max；off = 关闭思考）
 * 返回生成文件路径（sessionRoot/cordis.generated.yml）；写失败回退模板。
 */
export function writeRuntimeConfig(paths: RuntimePaths, effort = "max"): string {
  // profile 模式：配置由 profile 的 cordis.patch.yml 提供（env 驱动），
  // 不再生成 yml；llm-pi-ai providers / effort 经 DSH_LLM_PROVIDERS / DSH_EFFORT。
  if (paths.profileMode) {
    return join(paths.sessionRoot, GENERATED_CONFIG_NAME);
  }
  const target = join(paths.sessionRoot, GENERATED_CONFIG_NAME);
  try {
    const template = readFileSync(paths.config, "utf8");
    // llm-pi-ai：catalog 自带 anthropic/openai/deepseek 协议与模型目录；
    // providers dict 由 env 注入（sidecar 按设置页 providerConfig 构建）。
    const piAiEntry = [
      "",
      "# llm-pi-ai: anthropic/openai/自定义端点适配（providers 由 sidecar env 注入）",
      "- id: llm-pi-ai",
      "  name: '@deepseek-ai/dsh-llm-pi-ai'",
      "  config:",
      "    providers: !!js \"JSON.parse(process.env.DSH_LLM_PROVIDERS ?? '{}')\"",
      "",
      // message-feedback：消息反馈上报（sdk JSON-RPC 通用 remote 分发）。
      // 依赖 storageDomain → storage hub + storage-json 后端 + storage-domain 装配
      "# message-feedback: 消息赞踩上报（messageFeedback.put 经 JSON-RPC 通用 remote）",
      "- id: storage",
      "  name: '@deepseek-ai/dsh-storage'",
      "",
      "- id: storage-json",
      "  name: '@deepseek-ai/dsh-storage-json'",
      "  config:",
      "    root: !!js \"(process.env.DSH_SESSION_ROOT ?? process.cwd()) + '/storage'\"",
      "",
      "- id: storage-domain",
      "  name: '@deepseek-ai/dsh-storage-domain'",
      "  config:",
      "    backend: json",
      "",
      "- id: message-feedback",
      "  name: '@deepseek-ai/dsh-message-feedback'",
      "  config:",
      "    maxNoteBytes: 2000",
      "",
      // user-questions：引擎 ask_user_question 工具（sdk server 桥接为 JSON-RPC notification）
      "# user-questions: 引擎提问（ask_user_question 经 JSON-RPC 桥接）",
      "- id: user-questions",
      "  name: '@deepseek-ai/dsh-user-questions'",
      "",
      "- id: tool-ask-user",
      "  name: '@deepseek-ai/dsh-tool-ask-user'",
      "",
      // workflow：纯插件启用（对齐 dsh agent-presets 装配；无需改引擎）
      "# workflow: 工作流（workflow-worker-thread 引擎实现 + tool-workflow 模型工具）",
      "- id: workflow-worker-thread",
      "  name: '@deepseek-ai/dsh-workflow-worker-thread'",
      "  config:",
      "    provider: spawn",
      "",
      "- id: tool-workflow",
      "  name: '@deepseek-ai/dsh-tool-workflow'",
      "",
      // skills：技能目录扫描（skill.list RPC）+ /名称 调用注入；
      // 目录秩序含 ~/.dsh/skills 与项目 .dsh/skills（对齐官方 skill-filesystem）
      "# skills: 技能（skill-filesystem 扫描 + skill.list RPC + tool-skill 调用）",
      "- id: skill-filesystem",
      "  name: '@deepseek-ai/dsh-skill-filesystem'",
      "",
      "- id: skill",
      "  name: '@deepseek-ai/dsh-skill'",
      "",
      "- id: tool-skill",
      "  name: '@deepseek-ai/dsh-tool-skill'",
      "",
      // schedule：会话内定时提醒（schedule_create/list/delete LLM 工具，
      // 官方 web-schedule 同款装配；依赖 time-context）
      "# schedule: 定时提醒（after/at/every，对齐官方 web-schedule 装配）",
      "- id: time-context",
      "  name: '@deepseek-ai/dsh-time-context'",
      "",
      "- id: schedule",
      "  name: '@deepseek-ai/dsh-schedule'",
      "",
      // ---- 以下对齐官方 dsh-base bundle（web 版同款默认配置）----
      // 会话命名基础服务（title 存取/回退词数限制；llm 生成器在其上）
      "# session-title: 会话命名基础服务",
      "- id: session-title",
      "  name: '@deepseek-ai/dsh-session-title'",
      "  config:",
      "    fallbackMaxWords: 5",
      "    fallbackMaxBytes: 40",
      "    maxTitleBytes: 80",
      "",
      // 会话自动命名：首轮用户消息 → LLM 生成短标题（前端会话列表直接可用）
      "# session-title-llm: 会话自动命名（首轮消息 LLM 短标题）",
      "- id: session-title-llm",
      "  name: '@deepseek-ai/dsh-session-title-first-prompt-llm'",
      "  config:",
      "    targetWords: 5",
      "    targetCjkCharacters: 10",
      "    maxInputBytes: 4096",
      "    maxOutputTokens: 64",
      "    timeoutMs: 60000",
      "",
      // 工具结果修剪：超 8K 字符的结果压到头 4K + 尾 1K（对话压缩前先瘦身）
      "# tool-result-pruner: 超大工具结果先修剪（压缩器前置）",
      "- id: tool-result-pruner",
      "  name: '@deepseek-ai/dsh-compaction-tool-result-pruner'",
      "  config:",
      "    thresholdChars: 8192",
      "    headChars: 4096",
      "    tailChars: 1024",
      "",
      // /compact 手动压缩命令
      "# command-compact: /compact 手动压缩",
      "- id: command-compact",
      "  name: '@deepseek-ai/dsh-command-compact'",
      "",
      // 联网搜索：web_search 工具（DeepSeek 搜索路由，key 同聊天）
      "# web: 联网搜索（web_search 工具，DeepSeek 搜索路由）",
      "- id: web",
      "  name: '@deepseek-ai/dsh-web'",
      "  config:",
      "    searchProvider: deepseek-official",
      "",
      "- id: web-search-deepseek",
      "  name: '@deepseek-ai/dsh-web-search-deepseek'",
      "  config:",
      "    apiKeyEnv: DEEPSEEK_API_KEY",
      "",
      "- id: tool-web",
      "  name: '@deepseek-ai/dsh-tool-web'",
      "  config:",
      "    fetch: false",
      "    searchTimeoutMs: 60000",
      "",
      // 编辑工具（str_replace 风格）
      "# tool-str-replace-editor: 精确编辑工具",
      "- id: tool-str-replace-editor",
      "  name: '@deepseek-ai/dsh-tool-str-replace-editor'",
      "  config:",
      "    maxOutputChars: 16000",
      "",
      // 连续重复工具调用提醒
      "# repeat-tool-reminder: 连续重复调用提醒",
      "- id: repeat-tool-reminder",
      "  name: '@deepseek-ai/dsh-repeat-tool-reminder'",
      "  config:",
      "    thresholds: [3, 5, 8]",
      "    argumentsPreviewChars: 500",
      "",
      // LLM 重试
      "# llm-retry: LLM 请求重试",
      "- id: llm-retry",
      "  name: '@deepseek-ai/dsh-llm-retry'",
      "",
      // 指令系统（agent-instructions 文档注入，上限 64K）
      "# agent-instructions: 指令文档注入",
      "- id: agent-instructions",
      "  name: '@deepseek-ai/dsh-agent-instructions'",
      "  config:",
      "    maxBytes: 65536",
      "",
      // 目标追踪：/goal 命令 + goal 驱动（会话内目标持久化）
      "# goal: 目标追踪（/goal + goal-round-driver）",
      "- id: goal",
      "  name: '@deepseek-ai/dsh-goal'",
      "",
      "- id: goal-round-driver",
      "  name: '@deepseek-ai/dsh-goal-round-driver'",
      "",
      "- id: command-goal",
      "  name: '@deepseek-ai/dsh-command-goal'",
      "",
      "- id: tool-goal",
      "  name: '@deepseek-ai/dsh-tool-goal'",
      "",
      // 会话检索（SQLite 全文；:memory: 关闭内容搜索只留元数据读取）
      "# session-query-sqlite: 会话查询（:memory: 元数据模式）",
      "- id: session-query-sqlite",
      "  name: '@deepseek-ai/dsh-session-query-sqlite'",
      "  config:",
      "    path: ':memory:'",
      "    openAt: never",
      "",
      // pwsh 工具（Windows 原生 shell）
      "# tool-pwsh: Windows PowerShell 工具",
      "- id: tool-pwsh",
      "  name: '@deepseek-ai/dsh-tool-pwsh'",
      "",
      // ---- 社区插件（npm: dsh-workgroup / dsh-realtime-voice；经
      //      DSH_PLUGIN_NODE_PATH/内置 dsh-plugins 目录解析）----
      // workgroup: 工作组协作（成员=会话+角色标签，跨会话点对点消息）
      "# workgroup: 工作组协作（workgroup_create/spawn/send 等工具）",
      "- id: workgroup",
      "  name: 'dsh-workgroup'",
      "",
      // realtime-voice: 全双工语音对话（依赖 dsh-multi-model-provider 路由
      //   GPT Realtime / 豆包 Duplex；voice 前端经 host-webserver 的 WS 路由）
      "# realtime-voice: 全双工语音对话",
      "- id: multi-model-provider",
      "  name: 'dsh-multi-model-provider'",
      "",
      "- id: realtime-voice",
      "  name: 'dsh-realtime-voice'",
      "",
      // ---- 安全约束/沙箱体系（官方 dsh-base 同款；部署语义 = 工作区写权限 +
      //      无审批弹窗，与既有直接执行行为一致但约束体系就位；可用
      //      DSH_PERMISSION_MODE 覆盖为 read-only / danger-full-access）----
      "# sandbox: 文件效果边界（workspace-write 默认）",
      "- id: sandbox",
      "  name: '@deepseek-ai/dsh-sandbox-local'",
      "",
      "- id: sandbox-policy",
      "  name: '@deepseek-ai/dsh-sandbox-policy'",
      "  config:",
      "    mode: !!js process.env.DSH_PERMISSION_MODE ?? 'workspace-write'",
      "    workspaceRoot: !!js process.cwd()",
      "",
      "- id: bash-sandbox",
      "  name: '@deepseek-ai/dsh-bash-sandbox'",
      "  disabled: !!js process.platform === 'win32'",
      "  config:",
      "    timeoutMs: 60000",
      "",
      "- id: pwsh-sandbox",
      "  name: '@deepseek-ai/dsh-pwsh-sandbox'",
      "  disabled: !!js process.platform !== 'win32'",
      "",
      "# approval: 用户审批（never = 直接执行语义；可切 ask）",
      "- id: approval",
      "  name: '@deepseek-ai/dsh-user-approval'",
      "  config:",
      "    policy: 'never'",
      "",
      "- id: permission",
      "  name: '@deepseek-ai/dsh-permission-presets'",
      "  config:",
      "    presets:",
      "      read-only:",
      "        sandbox: read-only",
      "        approval: ask",
      "      workspace-write:",
      "        sandbox: workspace-write",
      "        approval: ask",
      "      danger-full-access:",
      "        sandbox: danger-full-access",
      "        approval: never",
      "",
      // 基础设施 hub（对齐官方树）
      "# 基础设施：timer/tools/llm/session/agent/typert/settings/credentials/shell-env/agent-loop",
      "- id: timer",
      "  name: '@deepseek-ai/cordis-plugin-timer'",
      "",
      "- id: tools",
      "  name: '@deepseek-ai/dsh-tools'",
      "",
      "- id: llm",
      "  name: '@deepseek-ai/dsh-llm'",
      "",
      "- id: session",
      "  name: '@deepseek-ai/dsh-session'",
      "",
      "- id: agent",
      "  name: '@deepseek-ai/dsh-agent'",
      "",
      "- id: typert",
      "  name: '@deepseek-ai/dsh-typert-registry'",
      "",
      "- id: typert-loader",
      "  name: '@deepseek-ai/dsh-typert-loader'",
      "",
      "- id: typert-gateway",
      "  name: '@deepseek-ai/dsh-api-gateway'",
      "",
      "- id: settings",
      "  name: '@deepseek-ai/dsh-settings-file'",
      "",
      "- id: credentials",
      "  name: '@deepseek-ai/dsh-credentials-local'",
      "",
      "- id: shell-env",
      "  name: '@deepseek-ai/dsh-shell-env'",
      "",
      "- id: agent-loop",
      "  name: '@deepseek-ai/dsh-agent-loop'",
      "  config:",
      "    agents: []",
      "",
      // 附件持久化（图片字节走内容寻址后端）
      "# attachment-local: 附件持久化",
      "- id: attachment-local",
      "  name: '@deepseek-ai/dsh-attachment-local'",
      "",
      // 工具链基础设施
      "# timeout-policy: 工具调用超时策略",
      "- id: timeout-policy",
      "  name: '@deepseek-ai/dsh-tool-call-timeout-policy'",
      "",
      // 溢出策略（大结果落盘）
      "# spill: 大结果溢出落盘",
      "- id: spill-local",
      "  name: '@deepseek-ai/dsh-spill-local'",
      "",
      "- id: spill-policy",
      "  name: '@deepseek-ai/dsh-spill-policy'",
      "  config:",
      "    maxInlineBytes: 50000",
      "",
      // 文件搜索（glob/grep）
      "# tool-fs-search: 文件搜索工具",
      "- id: tool-fs-search",
      "  name: '@deepseek-ai/dsh-tool-fs-search'",
      "  config:",
      "    sampleOverCapGlobResults: false",
      "",
      // 默认模型服务（agent 创建时读取；实际模型每请求经 JSON-RPC 传入）
      "# agent-default-model: 默认模型服务",
      "- id: agent-default-model",
      "  name: '@deepseek-ai/dsh-agent-default-model'",
      "  config:",
      "    provider: deepseek-official",
      "    model: deepseek-v4-flash",
      "",
      // fork 子代理 + 子代理控制/回报 + 投影注册表
      "# subagent-fork: fork 子代理（复用父历史的一次性分身）",
      "- id: subagent-fork-in-process",
      "  name: '@deepseek-ai/dsh-subagent-fork-in-process'",
      "  config:",
      "    providerName: fork",
      "",
      "- id: tool-subagent-fork",
      "  name: '@deepseek-ai/dsh-tool-subagent'",
      "  config:",
      "    provider: fork",
      "    toolName: subagent_fork",
      "    backgroundMode: one-shot",
      "",
      "# tool-subagent-control: 子代理控制（含 list-agents，依赖 session-projection）",
      "- id: session-projection",
      "  name: '@deepseek-ai/dsh-session-projection'",
      "",
      "- id: tool-subagent-control",
      "  name: '@deepseek-ai/dsh-tool-subagent-control'",
      "",
      "- id: tool-subagent-list-agents",
      "  name: '@deepseek-ai/dsh-tool-subagent-control/list-agents'",
      "",
      "- id: tool-subagent-report",
      "  name: '@deepseek-ai/dsh-tool-subagent-report'",
      "",
      // Ralph 迭代（构建期固定脚本的多轮 fresh-agent 循环）
      "# tool-ralph: Ralph 迭代",
      "- id: tool-ralph",
      "  name: '@deepseek-ai/dsh-tool-ralph'",
      "  config:",
      "    subagentProvider: spawn",
      "    maxRounds: 64",
      "",
      // 计划模式（引擎侧 plan 约束；前端计划模式联动的引擎语义）
      "# plan-mode: 计划模式引擎约束",
      "- id: plan-mode",
      "  name: '@deepseek-ai/dsh-plan-mode'",
      "  config:",
      "    section: |",
      "      You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user's conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.",
      "",
      "      Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.",
      "",
      "      The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed only to keep the request shape stable. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.",
      "",
      "      Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.",
      "",
      "      Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.",
      "",
      "      When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask \"should I proceed?\" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable or aborted, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation.",
      "",
      // 引擎斜杠命令注册表 + 命令反馈
      "# commands: 引擎斜杠命令（/compact /goal 等）",
      "- id: commands",
      "  name: '@deepseek-ai/dsh-commands'",
      "",
      "- id: command-feedback",
      "  name: '@deepseek-ai/dsh-command-feedback'",
      "",
    ].join("\n");
    let content = template.replace(/\n*$/, "\n") + piAiEntry;
    // 上下文预算：模板 8192 过小；按 1M 级模型窗口放大（80%≈80 万 tokens 才触发压缩）
    content = content.replace(/maxTokens:\s*8192/g, "maxTokens: 1000000");
    // 文件系统沙箱化：模板的 fs-local 替换为官方 fs-sandbox（文件效果受
    // sandbox-policy 约束，与 bash/pwsh 沙箱同一套边界）
    content = content.replace(
      /- id: fs-local\n  name: '@deepseek-ai\/dsh-fs-local'/,
      "- id: fs-sandbox\n  name: '@deepseek-ai/dsh-fs-sandbox'",
    );
    // time-context 注入限流：同回合多 step 不再每步刷"Time sampled…"（5 分钟内复用）
    content = content.replace(
      /(- id: time-context\n)/,
      "$1  config:\n    refreshIntervalMs: 300000\n",
    );
    // agent-spine 技能开关：模板默认 false，启用 skill.list 与技能调用必须打开
    content = content.replace(/skills:\s*\n(\s*)enabled:\s*false/, "skills:\n$1enabled: true");
    // 推理强度：off → 关闭思考；否则改写 llm-deepseek 的 reasoningEffort
    if (effort === "off") {
      content = content.replace(/thinking:\s*\w+/, "thinking: disabled");
    } else {
      content = content.replace(/reasoningEffort:\s*[\w-]+/, `reasoningEffort: ${effort}`);
    }
    mkdirSync(paths.sessionRoot, { recursive: true });
    writeFileSync(target, content, "utf8");
    log("runtime config written: %s (effort=%s)", target, effort);
    return target;
  } catch (err) {
    logError("writeRuntimeConfig failed (%s): %s", target, err instanceof Error ? err.message : String(err));
    return paths.config;
  }
}
