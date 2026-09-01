/**
 * rpc-http — 经引擎 web 面 /api 调 typert remote（connection ClientRequest wire）
 *
 * 背景（2026-09 深查确认）：SDK stdio JSON-RPC 白名单只有
 * initialize / session/prompt / shutdown——sidecar 此前所有经
 * harness.client.request() 的 typert remote（session/fork、
 * agentPresets.select、messageFeedback.put、session.selectModel、
 * commands.execute、settings.describe…）全部是死通道（"unknown SDK
 * runtime method"）。官方 typert remote 只走引擎 web 面：
 *   POST http://127.0.0.1:<MIRACH_WEB_PORT>/api/<ns>/<method>
 *   body: { type:"client-request", rpcId, method:"<ns>/<method>",
 *          payload:{ args:{ <wire参数名>: 值 } } }
 * 鉴权：与 vite-auth-helper 同算法铸造 browser-session cookie
 * （secret 从 DSH_HOME/.credentials.yaml 的 client-connection/browser-session 读）。
 *
 * 实测确认的 wire 参数名：单对象参数 = `request`；无参 = `_request:{}`；
 * session 类 agent 参数 = `agentId`；goals 三参 = {agentId, ref, request?}；
 * commands/execute = {agentId, line, images}。
 */

import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COOKIE_PREFIX = "dsh-auth-";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function credentialsFile(): string {
  return join(
    process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.cwd(), ".mirach"),
    ".credentials.yaml",
  );
}

/** 引擎 web 面基址（与 dsh.ts 注入的 MIRACH_WEB_PORT 一致）。 */
export function coreBase(): string {
  const port = process.env.MIRACH_WEB_PORT ?? "3212";
  return `http://127.0.0.1:${port}`;
}

function readSessionSecret(): Buffer | undefined {
  try {
    const raw = readFileSync(credentialsFile(), "utf8");
    const m = raw.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([^\s]+)/);
    if (m?.[1] === undefined) return undefined;
    const buf = Buffer.from(m[1], "base64url");
    return buf.byteLength === 32 ? buf : undefined;
  } catch {
    return undefined;
  }
}

function mintCookie(authority: string, secret: Buffer): string {
  const name = COOKIE_PREFIX + createHash("sha256").update(authority).digest("base64url");
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + MAX_AGE_MS };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
  return `${name}=v1.${body}.${sig}`;
}

export interface RemoteCallResult<T = unknown> {
  ok: boolean;
  value?: T;
  error?: { code: string; message: string; details?: unknown };
}

/**
 * 一次 typert remote 调用（web 面）。
 * @param endpoint - `<ns>/<method>` 斜杠形式（会话/主体命令映射已由调用方完成）。
 * @param args - wire 参数对象（按参数名）。
 * @returns 业务结果（ok/value 或 ok/error）；HTTP/传输失败抛 JSON-RPC 风格错误。
 */
export async function remoteCall<T = unknown>(
  endpoint: string,
  args: Record<string, unknown>,
  timeoutMs = 60_000,
): Promise<RemoteCallResult<T>> {
  const secret = readSessionSecret();
  if (secret === undefined) {
    return { ok: false, error: { code: "auth/unavailable", message: "browser-session secret 未配置（引擎未初始化）", details: {} } };
  }
  const base = coreBase();
  const authority = new URL(base).host;
  const cookie = mintCookie(authority, secret);
  const rpcId = randomUUID();
  const message = { type: "client-request", rpcId, method: endpoint, payload: { args } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: base,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, error: { code: `http/${response.status}`, message: `remote ${endpoint}: HTTP ${response.status}`, details: {} } };
    }
    const envelope = (await response.json()) as {
      result?: { ok: boolean; value?: unknown; error?: { code: string; message: string; details?: unknown } };
    };
    const result = envelope.result;
    if (result === undefined) {
      return { ok: false, error: { code: "protocol/invalid", message: `remote ${endpoint}: missing result envelope`, details: {} } };
    }
    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
      };
    }
    return { ok: true, value: result.value as T };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "transport/failed",
        message: `remote ${endpoint}: ${err instanceof Error ? err.message : String(err)}`,
        details: {},
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
