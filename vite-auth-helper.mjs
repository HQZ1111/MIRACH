/**
 * vite-auth-helper — 核心浏览器鉴权 cookie 的服务端铸造（Node 侧，vite.config 用）
 *
 * 官方链路：浏览器 GET /?token=<launchToken> 换签名 cookie（HttpOnly，浏览器
 * 永远拿不到值）。桌面内核经 vite 代理访问核心时没有 cookie → WS 升级 401。
 * 本助手在代理层（Node 侧可读 credentials 文件）按 browser-auth.ts 的同一算法
 * 铸出合法 cookie，注入每个代理请求/WS 升级的 Cookie 头——前端零改动。
 *
 * 算法对照 packages/client/connection/src/browser-auth.ts：
 *   name  = "dsh-auth-" + base64url(sha256(authority))
 *   value = "v1." + base64url(JSON{version,authority,issuedAt,expiresAt})
 *           + "." + base64url(HMAC-SHA256(body, secret))
 * secret 来源 = credentials-local 持久化的
 *   records["client-connection/browser-session"].payload.secret（base64url 32B）。
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

function readSessionSecret() {
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

function mintCookie(authority, secret) {
  const name = COOKIE_PREFIX + createHash("sha256").update(authority).digest().toString("base64url");
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + MAX_AGE_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
  return name + "=v1." + body + "." + sig;
}

export function coreAuthCookie(coreUrl) {
  try {
    const secret = readSessionSecret();
    if (secret === undefined) return undefined;
    const authority = new URL(coreUrl).host; // 经 changeOrigin 后核心看到的 Host
    return mintCookie(authority, secret);
  } catch {
    return undefined;
  }
}
