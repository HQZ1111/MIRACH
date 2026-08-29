/**
 * share-code — Starmap 分享码编解码（HML1 格式，纯函数，可单测）
 *
 * 格式：HML1:<base64url(JSON)>:<fnv1a-checksum>
 *   - 载荷是 JSON（v1：会话 / 项目 / 插件快照），UTF-8 → base64url（无填充）
 *   - 校验和：FNV-1a 32bit 的 base36 缩写，防复制时截断/污染
 *   - 前缀 HML1 用于识别与版本分叉（后续格式升级加 HML2 即可）
 *
 * 原型（Mirach Agent Ultra）使用 loadout 比特流 + DEFLATE 压缩编码，
 * 克隆端无对应 bit-pack 基础设施，改为 JSON 文本 —— 语义等价（能还原
 * 星图数据），码长略长但可读、可校验。
 */

export const SHARE_CODE_PREFIX = "HML1:";

/** 分享码载荷 v1 */
export interface ShareSession {
  id: string;
  title: string;
  createdAt: number;
  preview?: string;
  pinned?: boolean;
}

export interface ShareProject {
  id: string;
  name: string;
}

export interface SharePlugin {
  id: string;
  label: string;
}

export interface SharePayload {
  v: 1;
  /** 导出时刻（毫秒时间戳） */
  exportedAt: number;
  sessions: ShareSession[];
  projects: ShareProject[];
  plugins: SharePlugin[];
}

export type ShareCodeErrorCode = "bad-prefix" | "bad-checksum" | "bad-payload";

export class ShareCodeError extends Error {
  code: ShareCodeErrorCode;
  constructor(code: ShareCodeErrorCode, message: string) {
    super(message);
    this.name = "ShareCodeError";
    this.code = code;
  }
}

// ----------------------------------------------------------------
// base64url（UTF-8 安全，无 '=' 填充）
// ----------------------------------------------------------------

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): string {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ----------------------------------------------------------------
// FNV-1a 32bit → base36（8 字符校验）
// ----------------------------------------------------------------

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// ----------------------------------------------------------------
// 编解码
// ----------------------------------------------------------------

/** 编码分享码：HML1:<body>:<checksum>（body = base64url JSON） */
export function encodeShareCode(payload: SharePayload): string {
  const body = toBase64Url(JSON.stringify(payload));
  return `${SHARE_CODE_PREFIX}${body}:${fnv1a(body)}`;
}

/** 解码分享码；失败抛 ShareCodeError（bad-prefix / bad-checksum / bad-payload） */
export function decodeShareCode(code: string): SharePayload {
  const trimmed = code.trim();
  if (!trimmed.startsWith(SHARE_CODE_PREFIX)) {
    throw new ShareCodeError("bad-prefix", "分享码必须以 HML1: 开头");
  }
  const rest = trimmed.slice(SHARE_CODE_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  if (sep < 0) {
    throw new ShareCodeError("bad-checksum", "分享码缺少校验段");
  }
  const body = rest.slice(0, sep);
  const sum = rest.slice(sep + 1);
  if (fnv1a(body) !== sum) {
    throw new ShareCodeError("bad-checksum", "分享码校验失败，内容可能被截断或污染");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(body));
  } catch {
    throw new ShareCodeError("bad-payload", "分享码载荷不是有效 JSON");
  }
  const payload = parsed as Partial<SharePayload>;
  if (
    !payload ||
    typeof payload !== "object" ||
    payload.v !== 1 ||
    !Array.isArray(payload.sessions)
  ) {
    throw new ShareCodeError("bad-payload", "分享码数据格式不受支持");
  }
  return payload as SharePayload;
}
