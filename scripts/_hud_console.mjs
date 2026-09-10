// _hud_console.mjs — 在 HUD 页面里开 console/异常捕获，reload 一遍，把错误打出来
// 用法：node scripts/_hud_console.mjs [port] [waitMs]
const PORT = Number(process.argv[2] || 9222);
const WAIT = Number(process.argv[3] || 8000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && (t.url || "").includes("win=hud"));
if (!page) {
  console.error("no HUD target");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
const events = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  if (msg.id) {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
    else p.resolve(msg.result);
    return;
  }
  const { method, params } = msg;
  if (method === "Runtime.exceptionThrown") {
    const d = params.exceptionDetails || {};
    events.push(`[exception] ${d.text || ""} ${d.exception?.description || ""}`.slice(0, 1500));
  } else if (method === "Runtime.consoleAPICalled") {
    const args = (params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ");
    if (["error", "warning", "warn"].includes(params.type)) {
      events.push(`[console.${params.type}] ${String(args).slice(0, 1200)}`);
    }
  } else if (method === "Log.entryAdded") {
    const e = params.entry || {};
    if (e.level === "error" || e.level === "warning") {
      events.push(`[log.${e.level}] ${e.source} ${e.text} ${e.url ? e.url : ""}`.slice(0, 1200));
    }
  }
});
const sendCmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
await sendCmd("Runtime.enable");
await sendCmd("Log.enable");
await sendCmd("Page.enable");
await sendCmd("Page.reload", { ignoreCache: false });
await sleep(WAIT);
const res = await sendCmd("Runtime.evaluate", {
  expression: `JSON.stringify({rootChildren: document.getElementById('root')?.children.length ?? -1, text: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,300), title: document.title})`,
  returnByValue: true,
});
console.log("--- page state ---");
console.log(res.result?.value);
console.log("--- events (" + events.length + ") ---");
console.log(events.join("\n"));
ws.close();
