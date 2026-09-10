/**
 * dsh-kernel/transport — 官方客户端内核的宿主传输桥（打包态/tauri.localhost）
 *
 * 官方 connection 插件把物理载体外包给页面全局 `__DSH_TRANSPORT__`
 * （packages/client/connection/src/client/index.ts）：
 *   fetch      —— unary RPC（POST {origin}/api/<endpoint>）
 *   openStream —— Remote 逻辑流（web 面默认是 /api/remote.mux WebSocket）
 * 浏览器里这两条都受同源限制：打包态页面源是 http://tauri.localhost，
 * /api/* 会被资源协议当成 SPA 路径返回 index.html，WS 则直接连接失败；
 * 引擎的信任栅栏（Host 必须 loopback/trusted，Origin === Host，
 * sec-fetch-site ≠ cross-site）也拒绝任何浏览器跨源请求。
 *
 * 官方桌面壳（apps/desktop-host）的做法：请求交给宿主进程代发，页面只拿
 * 结果。mirach 的宿主是 Rust + agent-sidecar，故：
 *   fetch      → invoke("dsh_http_proxy") → sidecar 带 cookie 打引擎 /api
 *   openStream → invoke("dsh_mux_open")  → sidecar 开 WS 连 /api/remote.mux，
 *                帧经 tauri::ipc::Channel 回流（Rust mux_channels 路由）
 * 同一 fetch 也装进官方附件上传的页面钩子 __DSH_FILE_UPLOAD__（否则上传
 * worker 的 XHR 会打到资源协议上）。
 *
 * dev（vite 代理同源）同样可用本桥——单一链路，不再依赖 vite proxy 的存在。
 */

import { Channel, invoke } from "@tauri-apps/api/core";

/** 本页面加载的世代 id：重载后新页面开流时，sidecar 借此回收上一代的 WS。 */
const PAGE_ID = crypto.randomUUID();

/** 允许代发的路径前缀（引擎 web 面；/dsh-pocket 是社区插件同源 RPC）。 */
const PROXY_PREFIXES = ["/api/", "/dsh-pocket/", "/dsh-realtime-voice/"];

/** 请求体分块阈值：超过则按块经 dsh_http_proxy_chunk 送（峰值内存 = 单块）。 */
const BODY_CHUNK_BYTES = 4 * 1024 * 1024;

/** 合成 Response 时不能原样带回的逐跳头。 */
const DROP_RESPONSE_HEADERS = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "set-cookie",
  "transfer-encoding",
]);

interface ProxyResponse {
  status: number;
  headers: [string, string][];
  bodyBase64: string | null;
}

interface MuxItemFrame {
  type: "item";
  streamId?: string;
  value?: unknown;
}
interface MuxErrorFrame {
  type: "error";
  streamId?: string;
  error: { code: string; message: string; details: object };
}
interface MuxEndFrame {
  type: "end";
  streamId?: string;
}
/** Rust 侧载体回收哨兵（WS 关闭/错误、sidecar 退出）。 */
interface MuxCloseFrame {
  type: "__mirach_close";
  reason?: string;
}
type MuxFrame = MuxItemFrame | MuxErrorFrame | MuxEndFrame | MuxCloseFrame;

/** 官方 connection 的流失败标记（normalizeConnectionStream 按它重建错误类）。 */
interface StreamFailureMarker {
  readonly kind: "remote" | "carrier";
  readonly code?: string;
  readonly details?: object;
}

function markerError(message: string, marker: StreamFailureMarker): Error {
  const error = new Error(message) as Error & { dshRemoteStreamFailure?: StreamFailureMarker };
  error.name = "MirachHostTransportError";
  error.dshRemoteStreamFailure = marker;
  return error;
}

function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 32 * 1024;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function bytesFromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function bodyToBytes(body: BodyInit | null | undefined): Promise<Uint8Array | null> {
  if (body === undefined || body === null) return null;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString());
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  if (typeof Blob !== "undefined" && body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    return new Uint8Array(await new Response(body).arrayBuffer());
  }
  // FormData / 其它：序列化失败宁可显式报错，不要静默发空体
  throw new Error(`kernel transport: unsupported request body ${String((body as { constructor?: { name?: string } }).constructor?.name)}`);
}

function requestUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input, location.origin);
  return new URL(input.url, location.origin);
}

/**
 * 宿主代发 fetch：同源 /api/*、/dsh-pocket/*、/dsh-realtime-voice/* 经 sidecar → 引擎，
 * 其余原样走浏览器 fetch（bundle/静态资源等）。
 * /dsh-realtime-voice/ 是全双工语音插件：client.js 与 audio-input-worklet.js 必须同源可加载
 * （CSP script-src 'self' 不允许跨源脚本；worklet 也只能从同源/blob 加载）。
 */
export async function hostFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = requestUrl(input);
  const proxied = PROXY_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
  if (!proxied || url.origin !== location.origin) {
    return fetch(input as RequestInfo, init);
  }
  if (init?.signal?.aborted) throw init.signal.reason;
  const headers: [string, string][] = [];
  new Headers(init?.headers).forEach((value, name) => { headers.push([name, value]); });
  const bytes = await bodyToBytes(init?.body);
  // AbortSignal 透传：请求 id 由前端生成，取消时经 dsh_http_proxy_cancel 让
  // sidecar abort 在途 HTTP（否则取消后请求仍会跑满 120s 超时）
  const requestId = crypto.randomUUID();
  const onAbort = (): void => {
    void invoke("dsh_http_proxy_cancel", { streamId: requestId }).catch(() => {});
  };
  init?.signal?.addEventListener("abort", onAbort, { once: true });
  let result: ProxyResponse;
  try {
    // 大请求体分块送：Rust/sidecar 侧不出现单条数百 MB 的 JSON 行（峰值内存 = 单块大小）
    const chunked = bytes !== null && bytes.byteLength > BODY_CHUNK_BYTES;
    const chunks: string[] = [];
    if (chunked && bytes !== null) {
      for (let offset = 0; offset < bytes.byteLength; offset += BODY_CHUNK_BYTES) {
        chunks.push(base64FromBytes(bytes.subarray(offset, offset + BODY_CHUNK_BYTES)));
      }
    }
    const start = invoke<ProxyResponse>("dsh_http_proxy", {
      path: url.pathname + url.search,
      method: init?.method ?? "GET",
      headers,
      bodyBase64: chunked || bytes === null ? null : base64FromBytes(bytes),
      requestId,
      ...(chunked ? { bodyChunks: chunks.length } : {}),
    });
    for (let i = 0; i < chunks.length; i++) {
      await invoke("dsh_http_proxy_chunk", { streamId: requestId, index: i, data: chunks[i] });
    }
    result = await start;
  } finally {
    init?.signal?.removeEventListener("abort", onAbort);
  }
  if (init?.signal?.aborted) throw init.signal.reason;
  const bodyBytes = result.bodyBase64 === null || result.bodyBase64 === ""
    ? null
    : bytesFromBase64(result.bodyBase64);
  const responseHeaders = new Headers();
  for (const [name, value] of result.headers) {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) responseHeaders.append(name, value);
  }
  const nullBodyStatus = result.status === 204 || result.status === 205 || result.status === 304;
  return new Response(nullBodyStatus ? null : bodyBytes, {
    status: result.status,
    headers: responseHeaders,
  });
}

/**
 * 宿主代发 Remote 逻辑流：一条逻辑流 = 一条物理 WS（mux 协议只有 open/cancel），
 * 帧经 Rust Channel 回流；end 正常收尾，error 还原 Remote 错误，载体断开转
 * carrier 失败（官方重连机制接管）。
 */
export async function* hostOpenStream(
  endpoint: string,
  payload: unknown,
  signal: AbortSignal,
): AsyncGenerator<unknown> {
  const id = crypto.randomUUID();
  const inbox: MuxFrame[] = [];
  let wake: (() => void) | null = null;
  const channel = new Channel<MuxFrame>();
  channel.onmessage = (frame) => {
    inbox.push(frame);
    wake?.();
    wake = null;
  };
  const close = (): void => {
    void invoke("dsh_mux_close", { id }).catch(() => {});
  };
  const abort = (): void => {
    wake?.();
    wake = null;
    close();
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    try {
      await invoke("dsh_mux_open", { id, endpoint, payload, pageId: PAGE_ID, ch: channel });
    } catch (error) {
      // 宿主未就绪/连接失败属于载体故障：标记 carrier 让官方流机制退避重试，
      // 而不是当成终态业务错误（后者会永久打死 session 控制流）
      throw markerError(
        `kernel transport: mux open failed — ${error instanceof Error ? error.message : String(error)}`,
        { kind: "carrier" },
      );
    }
    for (;;) {
      while (inbox.length === 0) {
        if (signal.aborted) throw signal.reason;
        await new Promise<void>((resolve) => { wake = resolve; });
      }
      const frame = inbox.shift();
      if (frame === undefined) break;
      if (frame.type === "item") {
        yield frame.value;
        continue;
      }
      if (frame.type === "error") {
        throw markerError(frame.error.message, {
          kind: "remote",
          code: frame.error.code,
          details: frame.error.details,
        });
      }
      if (frame.type === "end") return;
      throw markerError(frame.reason ?? "kernel transport: mux carrier closed", { kind: "carrier" });
    }
  } finally {
    signal.removeEventListener("abort", abort);
    close();
  }
}

/** 页面全局：官方 connection 与附件上传消费的载体钩子。 */
interface HostTransportGlobal {
  __DSH_TRANSPORT__?: {
    fetch: (input: URL, init: RequestInit) => Promise<Response>;
    openStream: (endpoint: string, payload: unknown, signal: AbortSignal) => AsyncIterable<unknown>;
    ownsHost?: boolean;
  };
  __DSH_FILE_UPLOAD__?: { fetch: (input: URL, init: RequestInit) => Promise<Response> };
  /** 官方 connection 的恢复节奏（desktop-host 同款注入点）。 */
  __DSH_CONNECTION_RECOVERY__?: Record<string, number>;
}

/**
 * 官方连接恢复默认值（packages/client/connection/src/recovery-config.ts）。
 * 客户端缺失该全局时按同值工作——这里显式声明，使 mirach 有一个可调单点
 * （对齐官方 desktop-host 把宿主配置注入页面的做法）。
 */
const CONNECTION_RECOVERY_DEFAULTS: Record<string, number> = {
  backoffBaseMs: 500,
  backoffFactor: 2,
  backoffMaxMs: 10_000,
  generationReadyWarnMs: 3_000,
  generationReadyTimeoutMs: 15_000,
};

/**
 * 安装宿主传输桥（幂等；必须在官方 connection/file-upload 插件 apply 前调用，
 * 两者都在 apply 时读取页面全局）。
 */
export function installKernelTransport(): void {
  const g = globalThis as unknown as HostTransportGlobal;
  if (g.__DSH_CONNECTION_RECOVERY__ === undefined) {
    g.__DSH_CONNECTION_RECOVERY__ = { ...CONNECTION_RECOVERY_DEFAULTS };
  }
  if (g.__DSH_TRANSPORT__?.ownsHost === true) return;
  g.__DSH_TRANSPORT__ = {
    // 宿主（Rust/sidecar）就在本机拥有引擎：特权面（设置文件/本地面板）按
    // loopback 放行——官方 desktop-host 同款声明
    ownsHost: true,
    fetch: hostFetch,
    openStream: hostOpenStream,
  };
  if (g.__DSH_FILE_UPLOAD__ === undefined) {
    g.__DSH_FILE_UPLOAD__ = { fetch: hostFetch };
  }
}
