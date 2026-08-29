/**
 * password - 启动密码（本地加盐哈希，Web Crypto SHA-256）
 *
 * 开启后每次启动先显示登录页（主界面在背后渲染），输对密码无缝进入；
 * 关闭则先播连接动画（splash）再进主页。
 * 密码存 localStorage（salt + hash，明文不落盘；桌面本地锁，非强安全边界）。
 */

import { atom } from "nanostores";

const KEY = "mirach.password.v1";
/** 混淆存储的明文（忘记密码乱码提示用）。XOR+base64，非加密；本地桌面锁，非强安全边界 */
const OBF_KEY = "mirach.password.obf.v1";
/** 启用标记（关闭密码登录时保留密码数据、仅禁用；重新开启直接用原密码） */
const ENABLED_KEY = "mirach.password.enabled.v1";
const OBF_SEED = "hermes-local-obfuscate-v1";

/** 启动阶段：splash（连接动画）→ locked（密码登录页）→ ready（主界面） */
export const $startupPhase = atom<"splash" | "locked" | "ready">("splash");

function xorEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ OBF_SEED.charCodeAt(i % OBF_SEED.length);
  }
  let bin = "";
  out.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function xorDecode(encoded: string): string {
  const bin = atob(encoded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i) ^ OBF_SEED.charCodeAt(i % OBF_SEED.length);
  }
  return new TextDecoder().decode(out);
}

export function lockApp(): void {
  $startupPhase.set("locked");
}
export function unlockApp(): void {
  $startupPhase.set("ready");
}

/** 首次配置完成标记（模型 API 设置页只在首次登录流程出现，锁定/后续启动不再出现） */
const FIRST_RUN_KEY = "mirach.firstRunDone.v1";

export function isFirstRun(): boolean {
  try {
    return localStorage.getItem(FIRST_RUN_KEY) !== "true";
  } catch {
    return false;
  }
}

export function completeFirstRun(): void {
  try {
    localStorage.setItem(FIRST_RUN_KEY, "true");
  } catch {
    /* 隐私模式等：忽略 */
  }
}

function readEnabled(): boolean {
  try {
    // 密码数据存在且未被显式禁用 → 启用（老数据无 ENABLED_KEY 视为启用）
    return localStorage.getItem(KEY) !== null && localStorage.getItem(ENABLED_KEY) !== "false";
  } catch {
    return false;
  }
}

export const $passwordEnabled = atom<boolean>(readEnabled());

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function readStored(): { salt: string; hash: string } | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as { salt: string; hash: string }) : null;
  } catch {
    return null;
  }
}

/** 设置 / 修改密码（至少 4 位） */
export async function setAppPassword(pw: string): Promise<void> {
  if (pw.length < 4) throw new Error("密码至少 4 位");
  const salt = crypto
    .getRandomValues(new Uint8Array(16))
    .reduce((a, b) => a + b.toString(16).padStart(2, "0"), "");
  const hash = await sha256Hex(salt + pw);
  localStorage.setItem(KEY, JSON.stringify({ salt, hash }));
  localStorage.setItem(OBF_KEY, xorEncode(pw));
  localStorage.setItem(ENABLED_KEY, "true");
  $passwordEnabled.set(true);
}

/** 关闭密码登录：保留密码数据、仅禁用（重新开启可直接用原密码，无需重设） */
export function clearAppPassword(): void {
  localStorage.setItem(ENABLED_KEY, "false");
  $passwordEnabled.set(false);
}

/** 重新开启密码登录（沿用已保留的原密码，不要求重新设置） */
export function enableAppPassword(): void {
  if (localStorage.getItem(KEY) === null) return;
  localStorage.setItem(ENABLED_KEY, "true");
  $passwordEnabled.set(true);
}

/** 是否已有保留的密码数据（决定"开启密码登录"时直接用原密码还是需新设置） */
export function hasPasswordData(): boolean {
  try {
    return localStorage.getItem(KEY) !== null;
  } catch {
    return false;
  }
}

/** 读取混淆存储的密码明文（「忘记密码」乱码提示用；无则返回 null） */
export function getObfuscatedPassword(): string | null {
  try {
    const raw = localStorage.getItem(OBF_KEY);
    return raw ? xorDecode(raw) : null;
  } catch {
    return null;
  }
}

/** 校验密码 */
export async function verifyAppPassword(pw: string): Promise<boolean> {
  const stored = readStored();
  if (!stored) return false;
  return (await sha256Hex(stored.salt + pw)) === stored.hash;
}
