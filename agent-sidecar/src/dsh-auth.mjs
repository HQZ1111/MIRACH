/**
 * dsh-auth — 官方 browser-auth cookie 铸造的唯一共享实现
 * （agent-sidecar 与 vite 配置共用；官方协议耦合面清单见 docs/protocol-coupling.md）
 *
 * 官方链路：浏览器 GET /?token=<launchToken> 换签名 cookie（HttpOnly）。桌面侧
 * （vite 代理 / sidecar web 面调用）没有 cookie → 401。本模块在 Node 侧按
 * packages/client/connection/src/browser-auth.ts 的同一算法铸出合法 cookie。
 *
 * ⚠ 升级检查点（官方改动此处需跟改，全仓只此一份实现）：
 *   name  = "dsh-auth-" + base64url(sha256(authority))
 *   value = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
 *           + "." + base64url(HMAC-SHA256(body, secret))
 *   secret = ~/.mirach/.credentials.yaml 的
 *           records["client-connection/browser-session"].payload.secret（base64url 32B）
 *   cookie 有效期 30 天。
 */

import { createHash, createHmac } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const COOKIE_PREFIX = "dsh-auth-";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function credentialsFile() {
  return join(process.env.DSH_HOME ?? join(homedir(), ".mirach"), ".credentials.yaml");
}

/** browser-session secret（base64url 32B）；未配置/格式不符返回 undefined */
export function readSessionSecret() {
  const f = credentialsFile();
  if (!existsSync(f)) return undefined;
  const m = readFileSync(f, "utf8").match(
    /client-connection\/browser-session:[\s\S]*?secret:\s*(\S+)/,
  );
  if (m === undefined) return undefined;
  try {
    const buf = Buffer.from(m[1], "base64url");
    return buf.byteLength === 32 ? buf : undefined;
  } catch {
    return undefined;
  }
}

/** 按官方 browser-auth 算法铸 cookie（name=value 形式，直接放进 Cookie 头） */
export function mintCookie(authority, secret) {
  const name = COOKIE_PREFIX + createHash("sha256").update(authority).digest().toString("base64url");
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + MAX_AGE_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
  return name + "=v1." + body + "." + sig;
}

/** 对核心 web 面（authority 取自 URL host）铸 cookie；secret 缺失返回 undefined */
export function browserAuthCookie(coreUrl) {
  try {
    const secret = readSessionSecret();
    if (secret === undefined) return undefined;
    const authority = new URL(coreUrl).host; // 经 changeOrigin 后核心看到的 Host
    return mintCookie(authority, secret);
  } catch {
    return undefined;
  }
}
