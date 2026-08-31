/**
 * plugins — 社区插件一键管理（mirach 自有安装器）
 *
 * 机制 = 官方 `dsh plugin add` 的手工等价自动化（三步）：
 *   ① npm install <pkg> 装进 ~/.mirach/dsh-plugins/node_modules（引擎 NODE_PATH 覆盖）；
 *   ② junction 到 profile node_modules（cordis 模块解析可达）；
 *   ③ profile cordis.patch.yml 追加插件行（幂等）。
 * 装载发生在 runtime 启动 —— 安装/卸载后需重启应用生效。
 *
 * 内置三件（workgroup/realtime-voice/tavern）在 UI 层禁用卸载；本模块仍允许
 * 高级用户经 API 操作（不做硬拒绝）。
 */

import { exec } from "node:child_process";
import net from "node:net";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, lstatSync, symlinkSync, rmSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { log, logWarn } from "./protocol.js";

const execP = promisify(exec);

const DSH_HOME = (): string => process.env.DSH_HOME ?? join(homedir(), ".mirach");
const PLUGINS_NM = (): string => join(DSH_HOME(), "dsh-plugins", "node_modules");
const PROFILE_DIR = (): string => join(DSH_HOME(), "profiles", process.env.MIRACH_PROFILE_NAME ?? "mirach");
const PROFILE_NM = (): string => join(PROFILE_DIR(), "node_modules");
const PROFILE_PATCH = (): string => join(PROFILE_DIR(), "cordis.patch.yml");

/** 内置三件（UI 禁用卸载；junction + patch 行随 mirach 发布维护） */
export const BUILTIN_PLUGINS = new Set(["dsh-workgroup", "dsh-realtime-voice", "dsh-tavern"]);

export interface InstalledPlugin {
  /** npm 包名（真实名，来自 package.json） */
  name: string;
  version: string;
  description: string;
  /** 是否为插件包（package.json 声明 dsh 字段） */
  isPlugin: boolean;
  /** profile cordis.patch.yml 已激活 */
  active: boolean;
  /** junction 已建 */
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

function activeInPatch(patchText: string, pkgName: string): boolean {
  return patchText.includes(`name: '${pkgName}'`);
}

/** 列出 dsh-plugins 里已安装的包（顶层 + scope 一级） */
export async function listPlugins(): Promise<InstalledPlugin[]> {
  const nm = PLUGINS_NM();
  if (!existsSync(nm)) return [];
  const patch = safeRead(PROFILE_PATCH());
  const profileNm = PROFILE_NM();
  const out: InstalledPlugin[] = [];
  const push = (fullName: string, dir: string): void => {
    if (fullName.startsWith(".") || fullName === ".package-lock.json") return;
    try {
      if (!lstatSync(dir).isDirectory()) return;
    } catch {
      return;
    }
    const pkg = readPkg(dir);
    const realName = pkg.name ?? fullName;
    out.push({
      name: realName,
      version: pkg.version ?? "",
      description: pkg.description ?? "",
      isPlugin: pkg.dsh !== undefined,
      active: activeInPatch(patch, realName),
      linked: existsSync(join(profileNm, fullName)),
      builtin: BUILTIN_PLUGINS.has(realName),
    });
  };
  for (const name of readdirSync(nm)) {
    if (name.startsWith(".")) continue;
    const dir = join(nm, name);
    try {
      if (!lstatSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    if (name.startsWith("@")) {
      for (const sub of readdirSync(dir)) {
        push(`${name}/${sub}`, join(dir, sub));
      }
    } else {
      push(name, dir);
    }
  }
  out.sort((a, b) => Number(b.isPlugin) - Number(a.isPlugin) || a.name.localeCompare(b.name));
  return out;
}

/** 从安装规格解析真实包名（x@1.2 → x；@a/b@1.2 → @a/b） */
function resolveRealName(spec: string): string {
  const noVersion = spec.split("@").length > 2 && spec.startsWith("@")
    ? "@" + spec.slice(1).split("@")[0]
    : spec.startsWith("@")
      ? spec
      : spec.split("@")[0];
  const pkg = readPkg(join(PLUGINS_NM(), noVersion));
  return pkg.name ?? noVersion;
}

/** 追加插件行到 profile cordis.patch.yml（幂等：按 name 判重） */
function appendPatch(pkgName: string, lines: string[]): void {
  const patchPath = PROFILE_PATCH();
  let text = safeRead(patchPath);
  if (!text) {
    text = "- insert:\n";
    logWarn("profile cordis.patch.yml 缺失，已创建：%s", patchPath);
  }
  if (text.includes(`name: '${pkgName}'`)) {
    lines.push("patch 已含该插件，跳过");
    return;
  }
  const entry = `    - id: ${pkgName.split("/").pop()}\n      name: '${pkgName}'`;
  const arr = text.split(/\r?\n/);
  let lastEntryIdx = -1;
  arr.forEach((l, i) => {
    if (/^    - id:/.test(l)) lastEntryIdx = i;
  });
  if (lastEntryIdx >= 0) {
    let at = lastEntryIdx + 1;
    while (at < arr.length && arr[at]!.trim() !== "" && !/^    - id:/.test(arr[at]!)) at++;
    arr.splice(at, 0, entry);
    writeFileSync(patchPath, arr.join("\n"), "utf8");
  } else {
    writeFileSync(patchPath, text.replace(/\s*$/, "\n") + "- insert:\n" + entry.split("\n").map((l) => "  " + l).join("\n") + "\n", "utf8");
  }
  lines.push("cordis.patch.yml 已更新");
}

/** 移除插件行（连同其 - id: 行） */
function removePatch(pkgName: string, lines: string[]): void {
  const patchPath = PROFILE_PATCH();
  const text = safeRead(patchPath);
  if (!text || !text.includes(`name: '${pkgName}'`)) return;
  const arr = text.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (/^    - id:/.test(arr[i]!) && i + 1 < arr.length && arr[i + 1]!.includes(`name: '${pkgName}'`)) {
      i++; // 连同 name 行一起跳过
      continue;
    }
    if (arr[i]!.includes(`name: '${pkgName}'`)) continue;
    out.push(arr[i]!);
  }
  writeFileSync(patchPath, out.join("\n"), "utf8");
  lines.push("cordis.patch.yml 已移除该插件");
}

/** 安装：npm install → junction → patch 追加。返回步骤日志。 */
export async function installPlugin(spec: string): Promise<string[]> {
  const pkg = spec.trim();
  if (!/^[@a-z0-9][\w@./-]*$/i.test(pkg)) throw new Error("包名不合法（npm 包名或 name@version）");
  const lines: string[] = [];
  const nm = PLUGINS_NM();
  mkdirSync(nm, { recursive: true });
  lines.push(`npm install ${pkg} …`);
  const { stderr } = await execP(`npm install ${pkg} --no-audit --no-fund --legacy-peer-deps`, {
    cwd: join(nm, ".."),
    windowsHide: true,
    timeout: 300_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr && stderr.trim()) lines.push("npm: " + stderr.trim().split(/\r?\n/).slice(-2).join(" / "));
  lines.push("npm 安装完成");
  const realName = resolveRealName(pkg);
  lines.push("包名：" + realName);
  // junction 到 profile node_modules
  const link = join(PROFILE_NM(), realName);
  const target = join(nm, realName);
  if (!existsSync(target)) throw new Error("安装后未找到包目录：" + target);
  mkdirSync(PROFILE_NM(), { recursive: true });
  let linked = false;
  try {
    linked = existsSync(link);
  } catch {
    linked = false;
  }
  if (!linked) {
    symlinkSync(target, link, "junction");
    lines.push("junction 已创建");
  } else {
    lines.push("junction 已存在，跳过");
  }
  appendPatch(realName, lines);
  lines.push("完成 —— 重启应用后生效");
  log("plugins.install %s OK", realName);
  return lines;
}

/** 卸载：patch 移除 → junction 删除 → npm uninstall。返回步骤日志。 */
export async function uninstallPlugin(pkgName: string): Promise<string[]> {
  const lines: string[] = [];
  removePatch(pkgName, lines);
  const link = join(PROFILE_NM(), pkgName);
  try {
    if (existsSync(link)) {
      rmSync(link, { force: true, recursive: true });
      lines.push("junction 已删除");
    }
  } catch (e) {
    logWarn("junction remove failed: %s", e instanceof Error ? e.message : String(e));
  }
  const nm = PLUGINS_NM();
  if (existsSync(join(nm, pkgName))) {
    await execP(`npm uninstall ${pkgName} --no-audit --no-fund --legacy-peer-deps`, {
      cwd: join(nm, ".."),
      windowsHide: true,
      timeout: 180_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    lines.push("npm 卸载完成");
  }
  lines.push("完成 —— 重启应用后生效");
  log("plugins.uninstall %s OK", pkgName);
  return lines;
}

// ── 手机接入（net.access）：局域网/虚拟网 IP + 连通性探测 ──

export interface NetAccessIface {
  /** 网卡名（Windows 上 Tailscale 网卡就叫 "Tailscale"） */
  name: string;
  address: string;
  kind: "lan" | "tailscale" | "zerotier" | "other";
  /** 核心 web 面在该地址:端口是否可达（未监听 = 开关未开/未重启） */
  reachable: boolean;
}

export interface NetAccessInfo {
  port: string;
  host: string;
  ifaces: NetAccessIface[];
}

function classifyIface(ip: string, ifName: string): NetAccessIface["kind"] {
  const lower = ifName.toLowerCase();
  // Tailscale CGNAT 段 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip) || lower.includes("tailscale")) return "tailscale";
  if (lower.includes("zerotier") || /^10\.147\./.test(ip)) return "zerotier";
  return "lan";
}

function checkReachable(ip: string, port: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(600);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
    socket.connect(Number(port) || 3212, ip);
  });
}

/** 枚举非内网 IPv4 网卡（分类 + 逐个探测核心 web 面连通性） */
export async function netAccessInfo(): Promise<NetAccessInfo> {
  const port = process.env.MIRACH_WEB_PORT ?? "3212";
  const host = process.env.MIRACH_WEB_HOST ?? "127.0.0.1";
  const out: NetAccessIface[] = [];
  for (const [ifName, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== "IPv4" || ni.internal) continue;
      const kind = classifyIface(ni.address, ifName);
      const reachable = await checkReachable(ni.address, port);
      out.push({ name: ifName, address: ni.address, kind, reachable });
    }
  }
  // 可达的排前面
  out.sort((a, b) => Number(b.reachable) - Number(a.reachable));
  return { port, host, ifaces: out };
}
