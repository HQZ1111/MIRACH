/**
 * kernel-bridge — 官方客户端内核（__DSH_TRANSPORT__）的宿主传输桥
 *
 * 打包态（tauri build）前端源是 http://tauri.localhost，官方内核的
 *   - unary RPC：POST {location.origin}/api/<endpoint>
 *   - 事件流：WS {location.origin}/api/remote.mux
 * 都落在 Tauri 资源协议上（/api/* 返回 index.html，WS 直接连接被拒）。
 * 引擎的浏览器信任栅栏（packages/client/connection/src/api-request-trust.ts）
 * 又要求 Host 为 loopback/trusted 且 Origin === Host、sec-fetch-site ≠ cross-site
 * —— 浏览器跨源请求无法满足，官方桌面壳的做法是把请求交给宿主进程（Electron
 * main）代发。mirach 的宿主是 sidecar：本模块在 Node 侧以 loopback + 官方
 * browser-session cookie 访问引擎（与 rpc-http.ts 同一鉴权路径），
 * 帧经 stdout JSONL 交 Rust 转 tauri::ipc::Channel 回前端（dsh_relay）。
 *
 * 协议（stdin → stdout）：
 *   in : {"type":"http_proxy","id","path","method","headers":[[k,v]],"bodyBase64"?}
 *   out: {"type":"result","id","data":{status,headers,bodyBase64}} | error 信封
 *   in : {"type":"mux_open","id","endpoint","payload"}
 *   out: {"type":"result","id"}（WS 已打开且 open 帧已发）
 *        {"type":"mux","id","frame":<RemoteStreamServerMessage>}
 *        {"type":"mux_close","id","reason"}
 *   in : {"type":"mux_close","id"}（前端取消/载体回收）
 */

import * as dshAuth from "./dsh-auth.mjs";
import { coreBase, isGatewayMode, gatewayAuthHeaders } from "./rpc-http.js";
import { log, logWarn, send } from "./protocol.js";

/** 逻辑流 id → 物理 WS（一次 openStream = 一条 WS；mux 协议只有 open/cancel）。 */
const sockets = new Map<string, WebSocket>();
/** 当前页面世代：页面重载后新世代的首个 mux_open 回收上一代遗留的 WS。 */
let currentPageId = "";

/** 代发请求体上限（base64 字符数，≈192MB 原始字节；引擎聚合限制 200MB 之内）。
 *  超过直接报错而不是无限缓冲——真正的流式分帧（官方 wire.ts 形状）见
 *  docs/official-adoption.md #7b。 */
const MAX_PROXY_BODY_CHARS = 256 * 1024 * 1024;
/** 代发响应体上限（原始字节）。 */
const MAX_PROXY_RESPONSE_BYTES = 64 * 1024 * 1024;
/** 在途代发请求的取消句柄（前端 AbortSignal → http_proxy_cancel）。 */
const proxyControllers = new Map<string, AbortController>();

/** 取消一条在途代发（请求可能已完成，静默返回）。 */
export function cancelHttpProxy(id: string): void {
  proxyControllers.get(id)?.abort(new Error("kernel bridge: request canceled by client"));
}

/** 鉴权：网关模式用令牌；本地用 browser-session cookie（与 rpc-http 同一套判定）。 */
function authHeaders(): { cookie: string; origin: string } | { auth: Record<string, string>; origin: string } | null {
  const base = coreBase();
  if (isGatewayMode()) {
    const auth = gatewayAuthHeaders();
    // 远端没给令牌也允许（有的部署在内网/反代后不加鉴权）
    return { auth, origin: base };
  }
  const secret = dshAuth.readSessionSecret();
  if (secret === undefined) return null;
  return { cookie: dshAuth.mintCookie(new URL(base).host, secret), origin: base };
}

interface ProxyRequest {
  id: string;
  path?: string;
  method?: string;
  headers?: [string, string][];
  bodyBase64?: string | null;
  /** 分块上传：请求体切成的块数（配合 http_proxy_chunk 逐块到达）。
   *  大附件走这条路径，避免 Rust/sidecar 侧出现单条数百 MB 的 JSON 行。 */
  bodyChunks?: number | null;
}

/** 分块请求体的收集状态（id → 累积块）。 */
interface BodyCollector {
  total: number;
  parts: Buffer[];
  resolve: (body: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const bodyCollectors = new Map<string, BodyCollector>();
/** 分块收集超时（块之间不设限，整体上限）。 */
const BODY_CHUNK_TIMEOUT_MS = 10 * 60_000;

/** 收到一块请求体（http_proxy_chunk 命令）；最后一块到达即唤醒等待方。 */
export function pushHttpProxyChunk(id: string, index: number, data: string): void {
  const collector = bodyCollectors.get(id);
  if (collector === undefined) return; // 请求已结束/被取消：静默丢弃
  collector.parts[index] = Buffer.from(data, "base64");
  const received = collector.parts.filter((p) => p !== undefined).length;
  if (received >= collector.total) {
    clearTimeout(collector.timer);
    bodyCollectors.delete(id);
    collector.resolve(Buffer.concat(collector.parts.filter((p) => p !== undefined)));
  }
}

/** 登记一次分块收集并等待块到齐（handleHttpProxy 用；同时供单测直接驱动）。 */
export function beginChunkedBody(id: string, total: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const timer = setTimeout(() => {
      bodyCollectors.delete(id);
      reject(new Error(`kernel bridge: chunked body timeout (${total} chunks expected)`));
    }, BODY_CHUNK_TIMEOUT_MS);
    bodyCollectors.set(id, { total, parts: [], resolve, reject, timer });
  });
}

/** 一次 unary RPC 代发：结果信封带 status/headers/bodyBase64（前端合成 Response）。 */
export async function handleHttpProxy(cmd: ProxyRequest): Promise<void> {
  const id = cmd.id;
  const path = typeof cmd.path === "string" ? cmd.path : "";
  // 只代发引擎面（内核只会打 /api/*；/dsh-pocket 是社区插件的同源 RPC）。
  // 先做字符串前缀检查（快速拒绝），再 URL 归一化复核（/api/../x 会绕过前者）。
  if (!path.startsWith("/api/") && !path.startsWith("/dsh-pocket/")) {
    send({ type: "error", id, message: `kernel bridge: refusing non-engine path ${path.slice(0, 80)}` });
    return;
  }
  const base = coreBase();
  let baseOrigin = "";
  let target: URL;
  try {
    const baseUrl = new URL(base);
    baseOrigin = baseUrl.origin;
    target = new URL(path, baseUrl);
  } catch {
    send({ type: "error", id, message: `kernel bridge: invalid path ${path.slice(0, 80)}` });
    return;
  }
  if (target.origin !== baseOrigin || (!target.pathname.startsWith("/api/") && !target.pathname.startsWith("/dsh-pocket/"))) {
    send({ type: "error", id, message: `kernel bridge: refusing non-engine path ${path.slice(0, 80)}` });
    return;
  }
  const bodyBase64 = typeof cmd.bodyBase64 === "string" ? cmd.bodyBase64 : null;
  if (bodyBase64 !== null && bodyBase64.length > MAX_PROXY_BODY_CHARS) {
    send({ type: "error", id, message: "kernel bridge: request body too large" });
    return;
  }
  const bodyChunks = typeof cmd.bodyChunks === "number" && cmd.bodyChunks > 0 ? cmd.bodyChunks : 0;
  try {
    // authHeaders() 内含 readFileSync（凭据文件可能被占用）——必须在 try 内，
    // 否则浮动 rejection 会直接杀死进程（无 unhandledRejection 兜底时）
    const auth = authHeaders();
    if (auth === null) {
      send({ type: "error", id, message: "kernel bridge: browser-session secret 未配置（引擎未初始化）" });
      return;
    }
    const headers = new Headers();
    for (const [name, value] of cmd.headers ?? []) {
      // 宿主代发：逐跳头与浏览器伪造头一律丢弃，Host/Cookie/Origin 由本层重建
      const lower = name.toLowerCase();
      if (
        lower === "host" ||
        lower === "cookie" ||
        lower === "origin" ||
        lower === "referer" ||
        lower === "content-length" ||
        lower === "transfer-encoding" ||
        lower === "connection"
      ) {
        continue;
      }
      try {
        headers.append(name, value);
      } catch {
        /* 非法头名丢弃（Headers 会抛） */
      }
    }
    if ("cookie" in auth) headers.set("cookie", auth.cookie);
    for (const [k, v] of Object.entries("auth" in auth ? auth.auth : {})) headers.set(k.toLowerCase(), v);
    headers.set("origin", auth.origin);
    // 大请求体走分块路径（bodyChunks）：等块到齐再发，避免单条巨型 JSON 行
    const body = bodyChunks > 0
      ? Buffer.concat([await beginChunkedBody(id, bodyChunks)])
      : bodyBase64
        ? Buffer.from(bodyBase64, "base64")
        : undefined;
    const bodyInit = body === undefined ? {} : { body: body as unknown as BodyInit };
    const controller = new AbortController();
    proxyControllers.set(id, controller);
    const timer = setTimeout(() => controller.abort(), 120_000);
    try {
      const response = await fetch(target, {
        method: cmd.method ?? "GET",
        headers,
        ...bodyInit,
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength > MAX_PROXY_RESPONSE_BYTES) {
        send({ type: "error", id, message: "kernel bridge: response too large" });
        return;
      }
      send({
        type: "result",
        id,
        data: {
          status: response.status,
          headers: [...response.headers.entries()],
          bodyBase64: bytes.toString("base64"),
        },
      });
    } catch (err) {
      logWarn("kernel bridge: http proxy %s failed: %s", path, err instanceof Error ? err.message : String(err));
      send({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      clearTimeout(timer);
      proxyControllers.delete(id);
    }
  } catch (err) {
    logWarn("kernel bridge: http proxy setup failed: %s", err instanceof Error ? err.message : String(err));
    send({ type: "error", id, message: err instanceof Error ? err.message : String(err) });
  }
}

interface MuxOpenRequest {
  id: string;
  endpoint?: string;
  payload?: unknown;
  /** 前端页面世代 id：换代（重载）时回收上一代全部 WS。 */
  pageId?: string;
}

/** 关闭一条逻辑流：通知前端 + 关闭物理 WS（幂等；事件回调按存在性去重）。 */
function closeSocket(id: string, reason: string): void {
  const ws = sockets.get(id);
  if (ws === undefined) return;
  sockets.delete(id);
  try {
    ws.close(1000, reason.slice(0, 100));
  } catch {
    /* 已关闭 */
  }
  send({ type: "mux_close", id, reason });
}

/** 打开一条逻辑流：物理 WS 连引擎 mux，open 帧随即发出，随后帧走 stdout。 */
export function handleMuxOpen(cmd: MuxOpenRequest): void {
  const id = cmd.id;
  const endpoint = typeof cmd.endpoint === "string" ? cmd.endpoint : "";
  if (!endpoint) {
    send({ type: "error", id, message: "kernel bridge: mux_open requires endpoint" });
    return;
  }
  // 页面重载：旧页面的生成器已被销毁，不会再来 mux_close——新世代首开时回收
  if (typeof cmd.pageId === "string" && cmd.pageId !== currentPageId) {
    if (currentPageId !== "" && sockets.size > 0) {
      log("kernel bridge: page generation changed — closing %d stale mux sockets", sockets.size);
      for (const stale of [...sockets.keys()]) closeSocket(stale, "page reloaded");
    }
    currentPageId = cmd.pageId;
  }
  const auth = authHeaders();
  if (auth === null) {
    send({ type: "error", id, message: "kernel bridge: browser-session secret 未配置（引擎未初始化）" });
    return;
  }
  const base = coreBase();
  const url = `${base.replace(/^http/, "ws")}/api/remote.mux`;
  let ws: WebSocket;
  try {
    // Node 全局 WebSocket（undici）扩展 headers 选项：loopback + cookie 过栅栏。
    // 官方 TS 类型只声明 (url, protocols?)，运行时形态经实测（见 probe-ws.mjs）。
    const WsWithHeaders = WebSocket as unknown as new (
      target: string,
      options: { headers: Record<string, string> },
    ) => WebSocket;
      ws = new WsWithHeaders(url, { headers: "cookie" in auth ? { cookie: auth.cookie } : { ...auth.auth } });
  } catch (err) {
    send({ type: "error", id, message: `kernel bridge: mux connect failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  let opened = false;
  // 与模块级 closeSocket 共用存在性判定：先移除者负责通知，事件回调不重复发
  const finish = (reason: string): void => { closeSocket(id, reason); };
  ws.addEventListener("open", () => {
    opened = true;
    try {
      ws.send(JSON.stringify({ type: "open", streamId: id, endpoint, payload: cmd.payload ?? { args: {} } }));
    } catch (err) {
      finish(`send failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    send({ type: "result", id, data: { opened: true } });
  });
  ws.addEventListener("message", (event) => {
    if (sockets.get(id) !== ws) return; // 已被回收（页面换代/前端取消）
    const raw = typeof event.data === "string" ? event.data : String(event.data);
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      finish("mux carrier received a non-JSON frame");
      return;
    }
    send({ type: "mux", id, frame });
  });
  ws.addEventListener("error", () => {
    if (!opened) {
      sockets.delete(id);
      send({ type: "error", id, message: "kernel bridge: mux WebSocket failed to open" });
      return;
    }
    finish("mux WebSocket error");
  });
  ws.addEventListener("close", (event) => {
    if (!opened) {
      sockets.delete(id);
      send({ type: "error", id, message: `kernel bridge: mux WebSocket closed before opening (${event.code})` });
      return;
    }
    finish(`mux WebSocket closed (${event.code})`);
  });
  sockets.set(id, ws);
}

/** 关闭一条逻辑流（前端取消/生成器收尾）。 */
export function handleMuxClose(cmd: { id: string }): void {
  const ws = sockets.get(cmd.id);
  if (ws === undefined) return;
  sockets.delete(cmd.id);
  try {
    ws.close(1000, "client closed");
  } catch {
    /* 已关闭 */
  }
  log("kernel bridge: mux closed %s", cmd.id);
}

/** 进程退出前收干净 WS（undici 在关闭中直接 exit 会触发 uv 断言）。 */
export async function shutdownKernelBridge(): Promise<void> {
  const all = [...sockets.values()];
  sockets.clear();
  for (const ws of all) {
    try {
      ws.close(1000, "sidecar shutdown");
    } catch {
      /* 已关闭 */
    }
  }
  if (all.length > 0) await new Promise((r) => setTimeout(r, 80));
}
