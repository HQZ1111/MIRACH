/**
 * Hermes agent-sidecar — dsh 运行时启动配置
 *
 * sidecar 本身只做中继：真正的 agent 是 DeepSeek Harness 的 JSON-RPC
 * 运行时子进程（`@deepseek-ai/dsh-sdk-client` 负责 spawn 与管理它的生命周期）。
 *
 * 引擎装配 = 官方 profile 机制（唯一路径）：
 *   `dsh --profile <name>`（npm 全局 CLI），profile 目录
 *   `$DSH_HOME/profiles/<name>/`（package.json dsh.profile.bundles +
 *   cordis.patch.yml overlay）。老的"模板 + 生成 yml"链路已删除。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// 官方 Harness home 解析（~ 展开 + 绝对化 + 空白 DSH_HOME 视同未设置）
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { log, logError } from "./protocol.js";

/** mirach 的 Harness home 默认值（与官方 CLI 的 ~/.dsh 隔离；DSH_HOME 覆盖优先）。 */
const MIRACH_DEFAULT_HOME = (): string => join(homedir(), ".mirach");

/**
 * 解析 mirach 数据根：DSH_HOME（非空）→ ~/.mirach，经官方 resolveDshHome
 * 归一化（展开 ~、转绝对路径、空串视为未设置）。
 */
export function mirachHome(): string {
  const fromEnv = process.env.DSH_HOME?.trim();
  return resolveDshHome(fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : MIRACH_DEFAULT_HOME());
}

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

export interface RuntimePaths {
  /** harness checkout 根（cwd 与 node_modules 解析基准）。 */
  harnessRoot: string;
  /** 运行时的 node 可执行文件。 */
  nodeBin: string;
  /** JSON-RPC 运行时入口（预构建 lib/bin.js）。 */
  entry: string;
  /** 工作区 cwd（DSH_CWD，bash/fs 工具的默认目录）。 */
  cwd: string;
  /** dsh 会话持久化目录（JSONL，zstd 压缩）。 */
  sessionRoot: string;
  /** 系统提示词（agent-spine persona）。 */
  systemPrompt: string;
  /** 环境变量中已存在的 DEEPSEEK_API_KEY（无则不设，运行时按 MISSING_CREDENTIAL 优雅失败）。 */
  apiKey: string | null;
  /** profile 模式（官方 profile 机制；唯一装配路径）。 */
  profileMode: boolean;
}

export function resolveRuntimePaths(): RuntimePaths {
  // 空串 env 视同未设置（避免 shell 残留的 DSH_HARNESS_ROOT= 遮蔽候选探测）
  const harnessRoot =
    (process.env.DSH_HARNESS_ROOT || undefined)
    ?? HARNESS_ROOT_CANDIDATES.find((p) => existsSync(p))
    ?? HARNESS_ROOT_CANDIDATES[0];
  const nodeBin = NODE_BIN_CANDIDATES.find((p) => existsSync(p)) ?? NODE_BIN_CANDIDATES[0];
  // 官方 profile 机制（唯一装配路径）：npm 全局 dsh CLI + $DSH_HOME/profiles/<name>/
  // package.json（bundles = base + sdk-app + web-app）。官方 profile 同时提供
  // stdio JSON-RPC（sdk 面）与 HTTP/WS（web 面），插件经 profile node_modules 解析。
  const npmDsh = process.env.APPDATA ? join(process.env.APPDATA, "npm", "dsh.cmd") : "";
  const dshHome = mirachHome();
  const profileName = process.env.MIRACH_PROFILE_NAME ?? "mirach";
  const profilePackage = join(dshHome, "profiles", profileName, "package.json");
  const profileMode =
    process.env.MIRACH_PROFILE === "1"
    || (process.env.MIRACH_PROFILE !== "0" && existsSync(npmDsh) && existsSync(profilePackage));
  const entry = profileMode
    ? join(harnessRoot, "apps", "cli", "src", "bin.ts")
    : process.env.DSH_RUNTIME_ENTRY
      ?? join(harnessRoot, "packages", "examples", "jsonrpc-demo", "lib", "bin.js");
  const cwd = process.env.DSH_CWD ?? process.env.USERPROFILE ?? harnessRoot;
  // 运行时持久化走 dshHomePath('sessions') = DSH_HOME/sessions
  // （base bundle session-persistence-jsonl 行）。sidecar 的历史读取/会话列举
  // 必须指向同一位置，否则切换会话后回放为空。
  const sessionRoot =
    process.env.DSH_SESSION_ROOT ?? join(dshHome, "sessions");
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

  if (!profileMode) {
    logError(
      `official dsh profile not found: ${profilePackage} (npm i -g @deepseek-ai/dsh@alpha, then launch once to initialize the profile)`,
    );
  }

  return {
    harnessRoot,
    nodeBin,
    entry,
    cwd,
    sessionRoot,
    systemPrompt: process.env.DSH_SYSTEM_PROMPT ?? "You are a coding agent.",
    apiKey: process.env.DEEPSEEK_API_KEY ?? null,
    profileMode,
  };
}
