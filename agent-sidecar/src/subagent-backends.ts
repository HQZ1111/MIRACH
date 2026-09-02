/**
 * subagent-backends — 外部子代理后端（Codex / Claude Code）的启用管理与鉴权注入
 *
 * 两个后端都是官方 Profile Bundle（dsh-subagent-codex / dsh-subagent-claude-code，
 * 自带 CLI 运行时 payload），装载经官方 `dsh plugin --profile` CLI；鉴权不走
 * 官方登录——key/base_url/model 存 <DSH_HOME>/subagent-backends.json（mirach
 * 设置页写入），在引擎 spawn 时组装成 CODEX_ENV / CLAUDE_ENV 注入（cordis
 * patch 经 !!js 读取），Codex 的第三方路由另生成原生 ~/.codex/config.toml。
 *
 * 升级检查点：CLI 入口（@deepseek-ai/dsh/lib/bin.js）、payload 包名/版本、
 * codex 原生 config 路径——见 apps/mirach/docs/protocol-coupling.md。
 */

import { exec, execSync } from "node:child_process";
import * as fs from "node:fs";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { logWarn } from "./protocol.js";

const execP = promisify(exec);

export interface BackendAuth {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface SubagentBackendsConfig {
  codex?: (BackendAuth & { enabled?: boolean }) | undefined;
  claude?: (BackendAuth & { enabled?: boolean }) | undefined;
}

export interface BackendStatus {
  installed: boolean;
  version: string | null;
  payloadOk: boolean;
}

export interface SubagentBackendsStatus {
  codex: BackendStatus;
  claude: BackendStatus;
  config: SubagentBackendsConfig;
}

const DSH_HOME = (): string => process.env.DSH_HOME ?? join(homedir(), ".mirach");
const PROFILE_NM = (): string => join(DSH_HOME(), "profiles", "mirach", "node_modules");
const CONFIG_FILE = (): string => join(DSH_HOME(), "subagent-backends.json");

const BACKEND_PKGS = {
  codex: "@deepseek-ai/dsh-subagent-codex",
  claude: "@deepseek-ai/dsh-subagent-claude-code",
} as const;

/** 各后端的运行时 payload 检查路径（相对 profile node_modules）。 */
const PAYLOAD_CHECKS = {
  codex: [
    "@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    "@openai/codex/bin/codex.js",
  ],
  claude: ["@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe"],
} as const;

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** 读取 mirach 设置页保存的子代理后端配置 */
export function readSubagentBackends(): SubagentBackendsConfig {
  const v = readJson(CONFIG_FILE()) as SubagentBackendsConfig | undefined;
  return v && typeof v === "object" ? v : {};
}

/** 写回配置（mirach 设置页经 write_user_file 直写；此方法供 sidecar 内部同步用） */
export function writeSubagentBackends(config: SubagentBackendsConfig): void {
  mkdirSync(DSH_HOME(), { recursive: true });
  writeFileSync(CONFIG_FILE(), JSON.stringify(config, null, 2));
}

function pkgVersion(pkgDir: string): string | null {
  try {
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function backendStatus(kind: keyof typeof BACKEND_PKGS): BackendStatus {
  const pkgDir = join(PROFILE_NM(), BACKEND_PKGS[kind]);
  const installed = existsSync(pkgDir);
  const payloadOk = PAYLOAD_CHECKS[kind].every((rel) => existsSync(join(PROFILE_NM(), rel)));
  return { installed, version: installed ? pkgVersion(pkgDir) : null, payloadOk };
}

/** 两个后端的安装状态 + 已保存配置（设置页"子代理后端"分区用） */
export function subagentBackendsStatus(): SubagentBackendsStatus {
  return { codex: backendStatus("codex"), claude: backendStatus("claude"), config: readSubagentBackends() };
}

/** dsh CLI 入口（与 dsh.ts 引擎启动同一全局安装）。 */
function dshBin(): string {
  const npm = join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "npm");
  return join(npm, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
}

async function dshCli(args: string): Promise<string> {
  const { stdout, stderr } = await execP(
    `${JSON.stringify(process.execPath)} ${JSON.stringify(dshBin())} ${args}`,
    {
      env: { ...process.env, DSH_HOME: DSH_HOME() },
      windowsHide: true,
      timeout: 600_000,
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  return (stdout + "\n" + stderr).trim();
}

/**
 * 启用/停用一个后端（跑官方 CLI；npm 负载下载失败时手动补齐——网络抖动常见）。
 * CLI 成败后把 config.enabled 收敛为实际安装态（前端预写可能滞后——CLI 变更
 * 以本函数结果为准）。
 * @returns CLI 输出行（设置页展示）
 */
export async function subagentSetEnabled(kind: keyof typeof BACKEND_PKGS, enable: boolean): Promise<string[]> {
  const lines: string[] = [];
  const pkg = BACKEND_PKGS[kind];
  try {
    if (enable) {
      lines.push(`dsh plugin add ${pkg}@0.1.2-alpha.4 …`);
      try {
        lines.push(await dshCli(`plugin --profile mirach add ${pkg}@0.1.2-alpha.4`));
      } catch (err) {
        lines.push("CLI 失败：" + (err instanceof Error ? err.message : String(err)).slice(0, 200));
      }
      // payload 手动补齐（官方 CLI 的 pnpm 在网络抖动下会漏装平台负载）
      for (const rel of PAYLOAD_CHECKS[kind]) {
        if (existsSync(join(PROFILE_NM(), rel))) continue;
        lines.push(`负载缺失，手动补齐：${rel.split("/")[0]} …`);
        lines.push(await ensurePayload(kind));
      }
      lines.push("启用完成 —— 重启应用生效");
    } else {
      lines.push(`dsh plugin remove ${pkg} …`);
      try {
        lines.push(await dshCli(`plugin --profile mirach remove ${pkg}`));
      } catch (err) {
        lines.push("CLI 失败：" + (err instanceof Error ? err.message : String(err)).slice(0, 200));
      }
      lines.push("停用完成 —— 重启应用生效");
    }
  } finally {
    // 同步 config.enabled（读改写保留鉴权字段）
    const cfg = readSubagentBackends();
    cfg[kind] = { ...(cfg[kind] ?? {}), enabled: enable };
    try {
      writeSubagentBackends(cfg);
    } catch {
      // 配置写失败不掩盖 CLI 结果
    }
  }
  return lines;
}

/** 手动补齐缺失的平台负载（npm pack + 解压到 profile node_modules）。 */
async function ensurePayload(kind: keyof typeof BACKEND_PKGS): Promise<string> {
  const spec =
    kind === "codex"
      ? "@openai/codex-win32-x64@npm:@openai/codex@0.149.1-win32-x64"
      : "@anthropic-ai/claude-agent-sdk-win32-x64@0.3.241";
  const dirName = kind === "codex" ? "@openai/codex-win32-x64" : "@anthropic-ai/claude-agent-sdk-win32-x64";
  const target = join(PROFILE_NM(), dirName);
  try {
    const tmp = join(DSH_HOME(), "tmp-payload");
    mkdirSync(tmp, { recursive: true });
    execSync(`npm pack ${JSON.stringify(spec)} --pack-destination ${JSON.stringify(tmp)}`, {
      cwd: DSH_HOME(),
      timeout: 600_000,
      windowsHide: true,
      stdio: "pipe",
    });
    const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack 未产出 tarball");
    execSync(`tar -xzf ${JSON.stringify(join(tmp, tgz))} -C ${JSON.stringify(tmp)}`, { windowsHide: true });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(join(tmp, "package"), target, { recursive: true });
    fs.rmSync(tmp, { recursive: true, force: true });
    return "负载已补齐：" + dirName;
  } catch (err) {
    logWarn("subagent payload fetch failed: %s", err instanceof Error ? err.message : String(err));
    return "负载补齐失败（网络）：可稍后在设置页重试启用";
  }
}

/** 引擎 spawn env 追加项：把 mirach 设置的 key/base_url/model 组装成 CODEX_ENV /
 *  CLAUDE_ENV（cordis patch 的 !!js 按名读取）+ 子代理权限策略（默认安全无人值守）。
 *  仅 enabled 的后端注入。
 */
export function subagentEnvForEngine(): Record<string, string> {
  const cfg = readSubagentBackends();
  const out: Record<string, string> = {};
  const codexCfg = cfg.codex;
  if (codexCfg?.enabled) {
    const env: Record<string, string> = {};
    // apiKey 直接给 codex 原生登录态（OPENAI_API_KEY 是 codex 官方读取的 key 名）；
    // CODEX_MODEL 供 cordis patch 的 subagent-codex provider 读取（固定委派模型）
    if (codexCfg.apiKey) env.OPENAI_API_KEY = codexCfg.apiKey;
    if (codexCfg.model) env.CODEX_MODEL = codexCfg.model;
    out.CODEX_ENV = JSON.stringify(env);
    ensureCodexNativeConfig(codexCfg);
  }
  const claudeCfg = cfg.claude;
  if (claudeCfg?.enabled) {
    const env: Record<string, string> = {};
    // ANTHROPIC_* 是 claude-code 官方读取的鉴权 env；留空缺省时随官方默认（登录态/环境）
    if (claudeCfg.apiKey) env.ANTHROPIC_AUTH_TOKEN = claudeCfg.apiKey;
    if (claudeCfg.baseUrl) env.ANTHROPIC_BASE_URL = claudeCfg.baseUrl;
    if (claudeCfg.model) env.ANTHROPIC_MODEL = claudeCfg.model;
    out.CLAUDE_ENV = JSON.stringify(env);
  }
  // 子代理统一权限策略（codex 默认 never = 安全无人值守；claude 默认 dontAsk）——
  // 未来若提供设置项，从这里接线即可；未设置时不给 env（patch 回落官方默认值）
  const perm = process.env.DSH_SUBAGENT_PERMISSION;
  if (perm) out.DSH_SUBAGENT_PERMISSION = perm;
  return out;
}

/**
 * Codex 第三方路由：生成原生 ~/.codex/config.toml 的 model_provider 段
 * （OpenAI 兼容 base_url + env_key=OPENAI_API_KEY + wire_api=chat）。
 * 只在 baseUrl 配置且文件未经用户手改（无 mirach 标记则不覆盖）时写入。
 */
function ensureCodexNativeConfig(auth: BackendAuth): void {
  if (!auth.baseUrl) return; // 纯 OpenAI key / 未配第三方路由：codex 原生默认 provider 即可
  const dir = join(homedir(), ".codex");
  const file = join(dir, "config.toml");
  const MARKER = "# managed-by: mirach";
  try {
    if (existsSync(file) && !readFileSync(file, "utf8").includes(MARKER)) return; // 用户手管，不动
    const model = auth.model ?? "gpt-5-codex";
    const toml = [
      `${MARKER} — 由 mirach 设置页生成；手动调整请先移除本行`,
      `model_provider = "mirach"`,
      `model = ${JSON.stringify(model)}`,
      ``,
      `[model_providers.mirach]`,
      `name = "mirach"`,
      `base_url = ${JSON.stringify(auth.baseUrl)}`,
      `env_key = "OPENAI_API_KEY"`,
      `wire_api = "chat"`,
      "",
    ].join("\n");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, toml);
  } catch (err) {
    logWarn("codex native config write failed: %s", err instanceof Error ? err.message : String(err));
  }
}
