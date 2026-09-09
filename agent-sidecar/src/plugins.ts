/**
 * plugins — 社区插件一键管理（官方机制直通）
 *
 * 安装/卸载直接调用官方 `dsh plugin --profile <name> add|remove <pkg>` CLI
 * （官方语义：转发 pnpm 维护 profile dependencies + lockfile；插件包自带
 * cordis.patch.yml 由 dsh.bundle.patch 机制接管，无需手改 patch 文件）。
 * bundles 清单由调用方维护（官方 apps/desktop project-manager 同款语义：
 * 重装已有插件 + 重写 dsh.profile.bundles）。
 *
 * list 为展示层：扫 profile node_modules 里带 dsh 字段的包（官方无 list 命令）。
 * 装载发生在 runtime 启动 —— 安装/卸载后需重启应用生效。
 *
 * 内置三件（workgroup/realtime-voice/tavern）在 UI 层禁用卸载；本模块仍允许
 * 高级用户经 API 操作（不做硬拒绝）。
 */

import { exec } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log, logWarn } from "./protocol.js";

const execP = promisify(exec);

const DSH_HOME = (): string => process.env.DSH_HOME ?? join(homedir(), ".mirach");
const PROFILE_DIR = (): string => join(DSH_HOME(), "profiles", process.env.MIRACH_PROFILE_NAME ?? "mirach");
const PROFILE_NM = (): string => join(PROFILE_DIR(), "node_modules");
const PROFILE_PKG = (): string => join(PROFILE_DIR(), "package.json");
/** 官方引擎入口（与 dsh.ts 同一解析：node 直接执行全局包 bin.js） */
const NPM_DSH_BIN = (): string =>
  process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js") : "";
const NODE_BIN = (): string => process.env.DSH_NODE_BIN ?? "node";

/** 内置三件（UI 禁用卸载；bundle 声明随 mirach profile 发布维护） */
export const BUILTIN_PLUGINS = new Set(["dsh-workgroup", "dsh-realtime-voice", "dsh-tavern"]);

export interface InstalledPlugin {
  /** npm 包名（真实名，来自 package.json） */
  name: string;
  version: string;
  description: string;
  /** 是否为插件包（package.json 声明 dsh 字段） */
  isPlugin: boolean;
  /** profile dependencies 已声明（官方 plugin 面的"已安装"） */
  active: boolean;
  /** profile node_modules 已落盘 */
  linked: boolean;
  builtin: boolean;
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readPkg(dir: string): { name?: string; version?: string; description?: string; dsh?: unknown } {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

function profileDependencies(): Record<string, string> {
  try {
    return (JSON.parse(safeRead(PROFILE_PKG())).dependencies ?? {}) as Record<string, string>;
  } catch {
    return {};
  }
}

function profileBundles(): string[] {
  try {
    return ((JSON.parse(safeRead(PROFILE_PKG())).dsh as { profile?: { bundles?: string[] } })?.profile?.bundles ?? []) as string[];
  } catch {
    return [];
  }
}

function writeProfileBundles(bundles: string[]): void {
  try {
    const j = JSON.parse(safeRead(PROFILE_PKG()));
    j.dsh = j.dsh ?? {};
    j.dsh.profile = j.dsh.profile ?? {};
    j.dsh.profile.bundles = bundles;
    writeFileSync(PROFILE_PKG(), JSON.stringify(j, null, 2) + "\n", "utf8");
  } catch (e) {
    logWarn("profile bundles rewrite failed: %s", e instanceof Error ? e.message : String(e));
  }
}

/** 官方 CLI：dsh plugin --profile <name> <args...>（node 直执行全局 bin.js） */
async function dshPluginCli(args: string[]): Promise<string> {
  const bin = NPM_DSH_BIN();
  if (!bin || !existsSync(bin)) throw new Error("官方 dsh CLI 不存在（npm i -g @deepseek-ai/dsh@alpha）");
  const { stdout, stderr } = await execP(
    `"${NODE_BIN()}" "${bin}" plugin --profile ${process.env.MIRACH_PROFILE_NAME ?? "mirach"} ${args.join(" ")}`,
    { cwd: PROFILE_DIR(), windowsHide: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 },
  );
  return [stdout, stderr].filter((s) => s && s.trim()).join("\n").trim();
}

/** 列出 profile dependencies 里已装的插件包（官方安装面） */
export async function listPlugins(): Promise<InstalledPlugin[]> {
  const nm = PROFILE_NM();
  const deps = profileDependencies();
  const bundles = profileBundles();
  const out: InstalledPlugin[] = [];
  for (const [name] of Object.entries(deps)) {
    const dir = join(nm, name);
    const pkg = readPkg(dir);
    out.push({
      name: pkg.name ?? name,
      version: pkg.version ?? deps[name] ?? "",
      description: pkg.description ?? "",
      isPlugin: pkg.dsh !== undefined,
      active: bundles.includes(name),
      linked: existsSync(dir),
      builtin: BUILTIN_PLUGINS.has(name),
    });
  }
  out.sort((a, b) => Number(b.isPlugin) - Number(b.builtin) - (Number(a.isPlugin) - Number(a.builtin)) || a.name.localeCompare(b.name));
  return out;
}

/** 安装：官方 CLI add → bundles 追加（幂等）。返回步骤日志。 */
export async function installPlugin(spec: string): Promise<string[]> {
  const pkg = spec.trim();
  if (!/^[@a-z0-9][\w@./-]*$/i.test(pkg)) throw new Error("包名不合法（npm 包名或 name@version）");
  const lines: string[] = [];
  lines.push(`dsh plugin add ${pkg} …`);
  lines.push(await dshPluginCli(["add", pkg]));
  // 官方 CLI 只维护 dependencies；bundles 清单由调用方维护（官方 project-manager 同款）
  const realName = resolveRealName(pkg);
  const bundles = profileBundles();
  if (!bundles.includes(realName)) {
    writeProfileBundles([...bundles, realName]);
    lines.push(`dsh.profile.bundles + ${realName}`);
  } else {
    lines.push("bundles 已含该插件，跳过");
  }
  lines.push("完成 —— 重启应用后生效");
  log("plugins.install %s OK", realName);
  return lines;
}

/** 卸载：bundles 移除 → 官方 CLI remove。返回步骤日志。 */
export async function uninstallPlugin(pkgName: string): Promise<string[]> {
  const lines: string[] = [];
  const bundles = profileBundles();
  if (bundles.includes(pkgName)) {
    writeProfileBundles(bundles.filter((b) => b !== pkgName));
    lines.push(`dsh.profile.bundles - ${pkgName}`);
  }
  lines.push(`dsh plugin remove ${pkgName} …`);
  lines.push(await dshPluginCli(["remove", pkgName]));
  lines.push("完成 —— 重启应用后生效");
  log("plugins.uninstall %s OK", pkgName);
  return lines;
}

/** 从安装规格解析真实包名（x@1.2 → x；@a/b@1.2 → @a/b；装完后以 package.json 为准） */
function resolveRealName(spec: string): string {
  const noVersion = spec.split("@").length > 2 && spec.startsWith("@")
    ? "@" + spec.slice(1).split("@")[0]
    : spec.startsWith("@")
      ? spec
      : spec.split("@")[0];
  const pkg = readPkg(join(PROFILE_NM(), noVersion));
  return pkg.name ?? noVersion;
}

// ── 引擎更新（npm alpha 通道）──

export interface EngineUpdateInfo {
  current: string;
  latest: string;
  hasUpdate: boolean;
}

function npmView(pkg: string, field: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execP(`npm view ${pkg} ${field} --json`, { windowsHide: true, timeout: 30_000 })
      .then((r) => resolve(String(r.stdout).trim().replace(/^"|"$/g, "")))
      .catch((e) => reject(new Error(String(e))));
  });
}

/** 检查引擎更新：npm alpha 通道最新版 vs 当前全局安装版本 */
export async function checkEngineUpdate(): Promise<EngineUpdateInfo> {
  const latest = await npmView("@deepseek-ai/dsh", "dist-tags.alpha");
  // 当前版本：全局 npm 包的 package.json
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh") : "";
  let current = "";
  try {
    current = JSON.parse(readFileSync(join(npmRoot, "package.json"), "utf8")).version ?? "";
  } catch {
    // 回退：dsh --version
    try {
      const { stdout } = await execP("dsh --version", { windowsHide: true, timeout: 15_000 });
      current = stdout.trim();
    } catch {
      current = "";
    }
  }
  return {
    current: current || "未知",
    latest: latest || "未知",
    hasUpdate: current !== latest && latest !== "未知",
  };
}

/** 一键更新引擎：npm i -g @deepseek-ai/dsh@alpha */
export async function updateEngine(): Promise<string[]> {
  const lines: string[] = [];
  lines.push("npm i -g @deepseek-ai/dsh@alpha …");
  const { stderr } = await execP("npm install -g @deepseek-ai/dsh@alpha --no-audit --no-fund", {
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr && stderr.trim()) lines.push("npm: " + stderr.trim().split(/\r?\n/).slice(-2).join(" / "));
  lines.push("引擎更新完成 —— 重启应用生效");
  return lines;
}
