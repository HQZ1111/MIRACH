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
 * 鉴权：browser-session cookie 由 dsh-auth.mjs 统一铸造（与 vite 代理
 * 同一实现；算法对照官方 browser-auth.ts，升级检查点见该文件头）。
 *
 * 实测确认的 wire 参数名：单对象参数 = `request`；无参 = `_request:{}`；
 * session 类 agent 参数 = `agentId`；goals 三参 = {agentId, ref, request?}；
 * commands/execute = {agentId, line, images}。
 */

import { randomUUID } from "node:crypto";
import * as dshAuth from "./dsh-auth.mjs";

/** 引擎 web 面基址。
 *
 * - 本地（默认）：`http://127.0.0.1:<MIRACH_WEB_PORT>`（sidecar 自己拉起的引擎）
 * - 网关模式（remote/cloud 连接）：`MIRACH_GATEWAY_URL`（远端已跑着的 dsh web 面），
 *   sidecar 不再本地拉引擎，只当桥接 → 本机零安装。
 */
export function coreBase(): string {
  const gateway = process.env.MIRACH_GATEWAY_URL;
  if (gateway && gateway.trim()) {
    return gateway.trim().replace(/\/+$/, "");
  }
  const port = process.env.MIRACH_WEB_PORT ?? "3212";
  return `http://127.0.0.1:${port}`;
}

/** 网关模式？（远端引擎 + 令牌鉴权；本地 cookie 铸不出来） */
export function isGatewayMode(): boolean {
  const gateway = process.env.MIRACH_GATEWAY_URL;
  return Boolean(gateway && gateway.trim());
}

/**
 * 鉴权头：
 * - 网关模式：`Authorization: Bearer <MIRACH_GATEWAY_TOKEN>`（远端 web 面/反代自行校验；
 *   也可直接填远端 `~/.dsh/.credentials.yaml` 里的 web secret，由 dsh-auth 在本地铸同样的 cookie）
 * - 本地：browser-session cookie（dsh-auth.mjs 铸造）
 */
export function authHeaders(base: string): Record<string, string> {
  if (isGatewayMode()) {
    return gatewayAuthHeaders();
  }
  const secret = dshAuth.readSessionSecret();
  if (secret === undefined) {
    return {};
  }
  const authority = new URL(base).host;
  return { Cookie: dshAuth.mintCookie(authority, secret) };
}

/**
 * 网关模式的鉴权头：`MIRACH_GATEWAY_TOKEN` 直接当 Bearer；
 * 若填的是 <name>=<value>（远端 web secret，或整段 cookie）则当 Cookie 发。
 * 为空则不加头（内网/反代自行控制的部署）。
 */
export function gatewayAuthHeaders(): Record<string, string> {
  const token = process.env.MIRACH_GATEWAY_TOKEN?.trim();
  if (!token) return {};
  if (/^[A-Za-z0-9_.-]+=[^;\s]*$/.test(token) || token.includes(";")) {
    return { Cookie: token };
  }
  return { Authorization: `Bearer ${token}` };
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
  const base = coreBase();
  const auth = authHeaders(base);
  if (Object.keys(auth).length === 0) {
    return { ok: false, error: { code: "auth/unavailable", message: "browser-session secret 未配置（引擎未初始化）", details: {} } };
  }
  const rpcId = randomUUID();
  const message = { type: "client-request", rpcId, method: endpoint, payload: { args } };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/api/${endpoint}`, {
      method: "POST",
      headers: {
        ...auth,
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
