// _hud_console2.mjs — HUD 窗口的 title / 内核 boot 日志（不做 reload，只看现状 + 抓后续日志）
const PORT = Number(process.argv[2] || 9222);
const WAIT = Number(process.argv[3] || 15000);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
const target = list.find((t) => (t.url || "").includes("win=hud"));
if (!target) {
  console.error("no hud target: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  if (m.id) {
    const q = pending.get(m.id);
    if (!q) return;
    pending.delete(m.id);
    if (m.error) q.reject(new Error(JSON.stringify(m.error)));
    else q.resolve(m.result);
    return;
  }
  if (m.method === "Runtime.consoleAPICalled") {
    const args = (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
    events.push(`[${m.params.type}] ${String(args).slice(0, 300)}`);
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails || {};
    events.push("[exception] " + (d.text || "") + " " + (d.exception?.description || "").slice(0, 400));
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
await send("Runtime.enable");
const st = await send("Runtime.evaluate", {
  expression: `JSON.stringify({
    title: document.title,
    hasTransport: typeof window.__DSH_TRANSPORT__,
    tauriLabel: window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? null,
    kernelReady: !!window.__MIRACH_KERNEL__,
    banner: /引擎未连接|引擎连接中/.test(document.body.innerText || ''),
  })`,
  returnByValue: true,
});
console.log("state: " + st.result?.value);
await new Promise((r) => setTimeout(r, WAIT));
console.log("--- console events (" + events.length + ") ---");
console.log(events.slice(-25).join("\n"));
ws.close();
