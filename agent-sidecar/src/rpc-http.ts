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
 * 鉴权：browser-session cookie 由 shared/dsh-auth.cjs 统一铸造（与 vite 代理
 * 同一实现；算法对照官方 browser-auth.ts，升级检查点见该文件头）。
 *
 * 实测确认的 wire 参数名：单对象参数 = `request`；无参 = `_request:{}`；
 * session 类 agent 参数 = `agentId`；goals 三参 = {agentId, ref, request?}；
 * commands/execute = {agentId, line, images}。
 */

import { randomUUID } from "node:crypto";
import * as dshAuth from "../../shared/dsh-auth.mjs";

/** 引擎 web 面基址（与 dsh.ts 注入的 MIRACH_WEB_PORT 一致）。 */
export function coreBase(): string {
  const port = process.env.MIRACH_WEB_PORT ?? "3212";
  return `http://127.0.0.1:${port}`;
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
  const secret = dshAuth.readSessionSecret();
  if (secret === undefined) {
    return { ok: false, error: { code: "auth/unavailable", message: "browser-session secret 未配置（引擎未初始化）", details: {} } };
  }
  const base = coreBase();
  const authority = new URL(base).host;
  const cookie = dshAuth.mintCookie(authority, secret);
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
