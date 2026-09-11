// _rpc_call.mjs — 在主窗里通过真实 IPC 调一个 Tauri 命令 / dsh_rpc
// 用法：node scripts/_rpc_call.mjs <dsh_rpc方法|tauri命令> [json参数]
//   node scripts/_rpc_call.mjs plugins.install '{"name":"dsh-multi-model-provider"}'
const [, , method, argsJson] = process.argv;
const PORT = 9222;
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");

// 挑一个**真的带 Tauri IPC 且页面已就绪**的 target：dev 冷启动时模块图要拉几分钟，
// 期间 #root 还没挂、`__TAURI_INTERNALS__` 也未必可用（早期版本盲选第一个 page 就踩过）。
const openWs = async (url) => {
  const ws = new WebSocket(url);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return ws;
};
let target = null;
for (const t of list) {
  const ws = await openWs(t.webSocketDebuggerUrl);
  let ok = false;
  try {
    const r = await new Promise((resolve) => {
      ws.addEventListener("message", (ev) => {
        const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        if (m.id === 1) resolve(m.result);
      });
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression: `typeof window.__TAURI_INTERNALS__ === 'object' && !!document.getElementById('root') && document.getElementById('root').children.length > 0`,
            returnByValue: true,
          },
        }),
      );
    });
    ok = r?.result?.value === true;
  } catch {
    ok = false;
  }
  if (ok && !target) {
    target = { t, ws };
  } else {
    ws.close();
  }
}
if (!target) {
  console.error("没有就绪的 Tauri 窗口（dev 冷启动模块图可能还在拉）: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
const ws = target.ws;
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  const q = pending.get(m.id);
  if (!q) return;
  pending.delete(m.id);
  if (m.error) q.reject(new Error(JSON.stringify(m.error)));
  else q.resolve(m.result);
});
const send = (m, p = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method: m, params: p }));
  });
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
await send("Runtime.enable");
const args = argsJson ? JSON.parse(argsJson) : {};
// 带点的 = dsh_rpc 方法（plugins.install …）；不带点的 = 直接调 Tauri 命令（hud_open …）
const isRpc = method.includes(".");
const expr = `(async () => {
  try {
    const r = ${isRpc
      ? `await window.__TAURI_INTERNALS__.invoke('dsh_rpc', { method: ${JSON.stringify(method)}, params: ${JSON.stringify(args)} })`
      : `await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(method)}, ${JSON.stringify(args)})`};
    return JSON.stringify({ ok: true, result: r ?? null }, null, 1);
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e).slice(0, 1500) }, null, 1);
  }
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 500) : res.result?.value);
ws.close();
