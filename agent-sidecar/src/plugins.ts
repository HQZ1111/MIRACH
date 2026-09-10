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

import { exec, execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
// 官方 profile 清单读写 + 装配组合（apps/desktop project-manager 同源）：
// bundles 读改写与"引擎实际装配行"都由官方实现产出，不再手搓 JSON/regex
import {
  composeEntries,
  loadProfileDirectory,
  readProfileManifest,
  writeProfileManifest,
  type ProfileManifest,
} from "@deepseek-ai/dsh-app-boot";
import { log, logWarn } from "./protocol.js";
import { mirachHome } from "./runtime.js";

const execP = promisify(exec);

const DSH_HOME = (): string => mirachHome();
const PROFILE_DIR = (): string => join(DSH_HOME(), "profiles", process.env.MIRACH_PROFILE_NAME ?? "mirach");
const PROFILE_NM = (): string => join(PROFILE_DIR(), "node_modules");
const PROFILE_PKG = (): string => join(PROFILE_DIR(), "package.json");
/** 官方引擎入口：优先 MIRACH_DSH_BIN（应用内安装的引擎），否则全局 npm 安装。 */
const NPM_DSH_BIN = (): string =>
  process.env.MIRACH_DSH_BIN ??
  (process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js") : "");
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

/** profile bundles 清单（官方 profile 清单读取；文件缺失/损坏返回空）。 */
export function profileBundles(): string[] {
  try {
    return readProfileManifest("mirach", PROFILE_DIR()).dsh?.profile?.bundles ?? [];
  } catch {
    return [];
  }
}

/** 写回 profile bundles（官方清单写入：2 空格 JSON + 尾换行，保留其余字段）。 */
function writeProfileBundles(bundles: string[]): void {
  try {
    const manifest: ProfileManifest = readProfileManifest("mirach", PROFILE_DIR());
    writeProfileManifest(PROFILE_DIR(), {
      ...manifest,
      dsh: {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles,
        },
      },
    });
  } catch (e) {
    logWarn("profile bundles rewrite failed: %s", e instanceof Error ? e.message : String(e));
  }
}

/**
 * 引擎实际装配行（settings 页插件清单）：官方 `loadProfileDirectory` +
 * `composeEntries` 组合 profile 各 bundle 的 patch 层与用户层，与引擎 boot
 * 同源；任一环节不可用时回退到 bundles 清单。
 */
export function profileEntryRows(): { id: string; name: string }[] {
  const dir = PROFILE_DIR();
  const bin = NPM_DSH_BIN();
  try {
    if (bin && existsSync(bin)) {
      const anchor = join(dirname(dirname(bin)), "package.json");
      const profile = loadProfileDirectory("mirach", dir, anchor);
      const rows = composeEntries([...profile.layers.map((layer) => layer.patches), profile.patches]);
      const entries = rows
        .filter((row) => typeof row.id === "string")
        .map((row) => ({
          id: String(row.id),
          name: String((row as { name?: unknown }).name ?? ""),
        }));
      if (entries.length > 0) return entries;
    }
  } catch (err) {
    logWarn(
      "profile entry compose failed (fallback to bundles): %s",
      err instanceof Error ? err.message : String(err),
    );
  }
  return profileBundles().map((name) => ({ id: name, name }));
}

/** npm 包名 / name@version / @scope/name@version（拒绝 ..、空格、shell 元字符）。 */
const PKG_SPEC = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[0-9a-zA-Z][0-9a-zA-Z.+_-]*)?$/i;

/** 校验并规范化插件安装规格；非法直接抛错（安装/卸载共用）。 */
function assertPackageSpec(spec: string): string {
  const s = spec.trim();
  if (!s || s.includes("..") || !PKG_SPEC.test(s)) {
    throw new Error("包名不合法（npm 包名或 name@version）");
  }
  return s;
}

/** 官方 CLI：dsh plugin --profile <name> <args...>（node 直执行全局 bin.js，数组参数不经 shell） */
function dshPluginCli(args: string[]): Promise<string> {
  const bin = NPM_DSH_BIN();
  if (!bin || !existsSync(bin)) throw new Error("官方 dsh CLI 不存在（npm i -g @deepseek-ai/dsh@alpha）");
  const profile = process.env.MIRACH_PROFILE_NAME ?? "mirach";
  return new Promise((resolve, reject) => {
    execFile(
      NODE_BIN(),
      [bin, "plugin", "--profile", profile, ...args],
      { cwd: PROFILE_DIR(), windowsHide: true, timeout: 600_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${err.message}${stderr.trim() ? `\n${stderr.trim()}` : ""}`));
          return;
        }
        resolve([stdout, stderr].filter((s) => s && s.trim()).join("\n").trim());
      },
    );
  });
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

/** profile package.json 原始文本（事务回滚快照用；不存在返回 null）。 */
function readProfileRaw(): string | null {
  try {
    return readFileSync(PROFILE_PKG(), "utf8");
  } catch {
    return null;
  }
}

/** 还原 profile package.json（回滚）。 */
function restoreProfileRaw(text: string): void {
  try {
    writeFileSync(PROFILE_PKG(), text, "utf8");
  } catch (e) {
    logWarn("profile manifest rollback failed: %s", e instanceof Error ? e.message : String(e));
  }
}

/**
 * 校验一个已安装包确实是可装配的插件（官方 project-manager 的 inspectPlugin 同款）：
 * package.json 的 name 一致、声明 `dsh.bundle.patch` 且 patch 文件在包目录内存在。
 */
export function verifyInstalledPlugin(packageDir: string, expectedName: string): { version: string; patch: string } {
  const manifest = readPkg(packageDir) as { name?: string; version?: string; dsh?: { bundle?: { patch?: unknown } } };
  if (manifest.name !== expectedName || typeof manifest.version !== "string") {
    throw new Error(`已安装包 ${expectedName} 的 package.json name/version 不一致`);
  }
  const patch = manifest.dsh?.bundle?.patch;
  if (typeof patch !== "string" || patch === "") {
    throw new Error(`${expectedName}@${manifest.version} 未声明 dsh.bundle.patch（不是可装配插件）`);
  }
  const patchPath = resolve(packageDir, patch);
  if (!(patchPath === packageDir || patchPath.startsWith(packageDir + sep)) || !existsSync(patchPath)) {
    throw new Error(`${expectedName}@${manifest.version} 的 bundle patch 路径非法或不存在：${patch}`);
  }
  return { version: manifest.version, patch: patchPath };
}

/**
 * 激活前试跑：把插件入口**真的 import 一次**，验证它在引擎依赖树里连得上。
 *
 * 为什么需要（2026-09-10 实测，见 docs/plugin-compat.md）：插件升级 dsh 后最常见的
 * 死法是**裸导入的引擎 API 被删/改名**，ESM 在链接期就抛
 * （`The requested module '@deepseek-ai/dsh-settings' does not provide an export named
 * 'settingsNamespace'`），cordis 的 include 条目 apply 失败 → 上下文失活 →
 * 引擎 initialize 只回一句 `cannot create effect on inactive context`，
 * 而"装进 bundles"这一步本身是成功的 —— 应用重启后直接打不开。
 *
 * import() 的解析基准是**被导入模块自己的位置**，与探针文件放哪无关，所以这一枪
 * 与引擎 boot 时的解析路径一致（pnpm 给每个插件铺的 node_modules）。
 * 副作用只是模块求值：插件入口只定义 cordis 插件对象，不碰运行中的引擎。
 *
 * 注意它拦不住"apply 期"才暴露的问题（缺服务、运行时守卫）；那类由
 * `markBundlesLastGood` / `rollbackBundlesIfChanged` 的启动兜底接住。
 */
export async function probePluginImport(packageDir: string, expectedName: string): Promise<void> {
  const manifest = readPkg(packageDir) as { main?: string; exports?: Record<string, unknown> | string };
  const entryRel = pickEntry(manifest);
  if (entryRel === null) {
    throw new Error(`${expectedName} 没有可用的入口（main/exports 都缺失）`);
  }
  const entry = resolve(packageDir, entryRel);
  if (!entry.startsWith(packageDir + sep) || !existsSync(entry)) {
    throw new Error(`${expectedName} 的入口文件不存在：${entryRel}`);
  }
  try {
    await import(pathToFileURL(entry).href);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${expectedName} 在引擎依赖树里加载失败：${msg}`);
  }
}

/** package.json → 入口相对路径（exports['.'] 优先，其次 main）。 */
function pickEntry(manifest: { main?: string; exports?: Record<string, unknown> | string }): string | null {
  const exp = manifest.exports;
  if (typeof exp === "string") return exp;
  if (exp && typeof exp === "object") {
    const dot = (exp as Record<string, unknown>)["."];
    if (typeof dot === "string") return dot;
    if (dot && typeof dot === "object") {
      const d = dot as Record<string, unknown>;
      for (const key of ["default", "import", "node", "require"]) {
        if (typeof d[key] === "string") return d[key] as string;
      }
    }
  }
  return typeof manifest.main === "string" ? manifest.main : null;
}

// ── bundles "last-good" 快照：引擎起不来时自动回滚（A 线：dsh 升级后插件对不上） ──

const LAST_GOOD_FILE = (): string => join(PROFILE_DIR(), "bundles.last-good.json");

/** 引擎 initialize 成功后记一次"这份 bundles 是能起的"。 */
export function markBundlesLastGood(engineVersion?: string): void {
  try {
    const record = { bundles: profileBundles(), engineVersion: engineVersion ?? null, at: new Date().toISOString() };
    writeFileSync(LAST_GOOD_FILE(), JSON.stringify(record, null, 2) + "\n", "utf8");
  } catch (err) {
    logWarn("bundles last-good snapshot failed: %s", err instanceof Error ? err.message : String(err));
  }
}

export interface BundlesRollbackReport {
  /** 本次被摘掉的插件（当前 bundles 有、last-good 没有） */
  removed: string[];
  /** 当前 bundles 缺的（last-good 有）—— 一并补回，回到能起的装配 */
  restored: string[];
  from: string[];
  to: string[];
}

/**
 * 引擎起不来时的兜底：当前 bundles 与 last-good 不一致就回滚，并报出被摘掉的插件。
 * 返回 null = 没有可回滚的差异（例如失败与插件无关，或从没成功起过）。
 */
export function rollbackBundlesIfChanged(): BundlesRollbackReport | null {
  let record: { bundles?: unknown };
  try {
    record = JSON.parse(readFileSync(LAST_GOOD_FILE(), "utf8")) as { bundles?: unknown };
  } catch {
    return null;
  }
  if (!Array.isArray(record.bundles) || record.bundles.some((b) => typeof b !== "string")) return null;
  const lastGood = record.bundles as string[];
  const current = profileBundles();
  const same = current.length === lastGood.length && current.every((b, i) => b === lastGood[i]);
  if (same) return null;
  const removed = current.filter((b) => !lastGood.includes(b));
  const restored = lastGood.filter((b) => !current.includes(b));
  writeProfileBundles(lastGood);
  logWarn("bundles rolled back to last-good (removed: %s)", removed.join(", ") || "-");
  return { removed, restored, from: current, to: lastGood };
}

/**
 * 安装插件（事务语义）：快照 profile 清单 → 官方 CLI add → 校验安装结果 →
 * 追加 bundles；任一步失败则恢复清单并尽力移除已装入的包。
 */
export async function installPlugin(spec: string): Promise<string[]> {
  const pkg = assertPackageSpec(spec);
  const lines: string[] = [];
  const snapshot = readProfileRaw();
  try {
    lines.push(`dsh plugin add ${pkg} …`);
    lines.push(await dshPluginCli(["add", pkg]));
    // 官方 CLI 只维护 dependencies；bundles 清单由调用方维护（官方 project-manager 同款）
    const realName = resolveRealName(pkg);
    const verified = verifyInstalledPlugin(join(PROFILE_NM(), realName), realName);
    lines.push(`已安装 ${realName}@${verified.version}（bundle patch 校验通过）`);
    // 激活前试跑：连引擎依赖树都 import 不进来的插件，绝不能写进 bundles
    // （写进去 = 下次启动引擎装配失败、应用打不开，见 docs/plugin-compat.md）
    try {
      await probePluginImport(join(PROFILE_NM(), realName), realName);
      lines.push("入口试跑通过（能进引擎依赖树）");
    } catch (probeErr) {
      const msg = probeErr instanceof Error ? probeErr.message : String(probeErr);
      lines.push(`入口试跑失败：${msg}`);
      throw new Error(`插件与当前引擎不兼容（已阻止激活）：${msg}`);
    }
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
  } catch (err) {
    // 回滚：恢复清单（bundles 不会被写坏）+ 尽力移除半装成功的包
    if (snapshot !== null) restoreProfileRaw(snapshot);
    await dshPluginCli(["remove", pkg]).catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    logWarn("plugins.install %s failed, rolled back: %s", pkg, msg);
    throw new Error(`安装失败已回滚：${msg}`);
  }
}

/**
 * 卸载插件（事务语义）：快照清单 → CLI remove → bundles 移除；CLI 失败则恢复清单
 * （插件仍可装配，避免"清单删了包还在"的半损状态）。
 */
export async function uninstallPlugin(pkgName: string): Promise<string[]> {
  const pkg = assertPackageSpec(pkgName);
  const lines: string[] = [];
  const snapshot = readProfileRaw();
  lines.push(`dsh plugin remove ${pkg} …`);
  try {
    lines.push(await dshPluginCli(["remove", pkg]));
  } catch (err) {
    if (snapshot !== null) restoreProfileRaw(snapshot);
    const msg = err instanceof Error ? err.message : String(err);
    logWarn("plugins.uninstall %s failed, manifest restored: %s", pkg, msg);
    throw new Error(`卸载失败（清单已恢复）：${msg}`);
  }
  const bundles = profileBundles();
  if (bundles.includes(pkg)) {
    writeProfileBundles(bundles.filter((b) => b !== pkg));
    lines.push(`dsh.profile.bundles - ${pkg}`);
  }
  lines.push("完成 —— 重启应用生效");
  log("plugins.uninstall %s OK", pkg);
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
  /** 最新版本发布时间（ISO，registry time 字段；缺省 null）。 */
  publishedAt: string | null;
  /** 最新版本包描述（作为"更新内容"摘要；缺省 null）。 */
  notes: string | null;
}

function npmView(pkg: string, field: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execP(`npm view ${pkg} ${field} --json`, { windowsHide: true, timeout: 30_000 })
      .then((r) => resolve(String(r.stdout).trim().replace(/^"|"$/g, "")))
      .catch((e) => reject(new Error(String(e))));
  });
}

/** 版本号规范化（去空白/引号；registry 值与本地 package.json 对齐比较）。 */
function normVer(v: string | undefined | null): string {
  return String(v ?? "").trim().replace(/^["'\s]+|["'\s]+$/g, "");
}

/** 检查引擎更新：npm alpha 通道最新版 vs 当前全局安装版本。
 *  hasUpdate 只在两边都是有效版本且不相等时为真（同版本不得可更新）；
 *  同时带出最新版本的发布时间与描述作为"更新内容"。 */
export async function checkEngineUpdate(): Promise<EngineUpdateInfo> {
  const latest = normVer(await npmView("@deepseek-ai/dsh", "dist-tags.alpha").catch(() => ""));
  // 当前版本：全局 npm 包的 package.json
  const npmRoot = process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh") : "";
  let current = "";
  try {
    current = normVer(JSON.parse(readFileSync(join(npmRoot, "package.json"), "utf8")).version);
  } catch {
    // 回退：dsh --version
    try {
      const { stdout } = await execP("dsh --version", { windowsHide: true, timeout: 15_000 });
      current = normVer(stdout);
    } catch {
      current = "";
    }
  }
  // 更新内容：registry 的发布时间 + 描述（一次 npm view 拿全）
  let publishedAt: string | null = null;
  let notes: string | null = null;
  if (latest) {
    try {
      const raw = await execP(`npm view @deepseek-ai/dsh@${latest} time description --json`, {
        windowsHide: true,
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = JSON.parse(String(raw.stdout)) as
        | { time?: Record<string, string>; description?: string }
        | Array<{ time?: Record<string, string>; description?: string }>;
      const obj = Array.isArray(parsed) ? parsed[0] : parsed;
      publishedAt = obj?.time?.[latest] ?? null;
      notes = obj?.description ?? null;
    } catch {
      /* 更新内容拿不到不影响版本判定 */
    }
  }
  const valid = /^\d+\.\d+\.\d+/.test(latest) && /^\d+\.\d+\.\d+/.test(current);
  return {
    current: current || "未知",
    latest: latest || "未知",
    hasUpdate: valid && current !== latest,
    publishedAt,
    notes,
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
