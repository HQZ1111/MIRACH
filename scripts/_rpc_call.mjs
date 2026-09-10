// _rpc_call.mjs — 在主窗里通过真实 IPC 调一个 Tauri 命令 / dsh_rpc
// 用法：node scripts/_rpc_call.mjs <dsh_rpc方法|tauri命令> [json参数]
//   node scripts/_rpc_call.mjs plugins.install '{"name":"dsh-multi-model-provider"}'
const [, , method, argsJson] = process.argv;
const PORT = 9222;
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
const target = list.find((t) => !(t.url || "").includes("win=")) ?? list[0];
if (!target) {
  console.error("no page target");
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
const expr = `(async () => {
  try {
    const r = await window.__TAURI_INTERNALS__.invoke('dsh_rpc', { method: ${JSON.stringify(method)}, params: ${JSON.stringify(args)} });
    return JSON.stringify({ ok: true, result: r ?? null }, null, 1);
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e).slice(0, 1500) }, null, 1);
  }
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 500) : res.result?.value);
ws.close();
