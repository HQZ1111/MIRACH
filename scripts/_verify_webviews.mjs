// _verify_webviews.mjs — 用主窗页面的 IPC 真调一遍内置浏览器/覆盖层命令
// 证明运行期新建的 child webview 不再撞 0x8007139F
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = Number(process.argv[2] || 9222);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !(t.url || "").includes("win="));
if (!page) {
  console.error("no main target; targets=" + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
console.log("main target: " + page.url);
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.error) p.reject(new Error(JSON.stringify(m.error)));
  else p.resolve(m.result);
});
const sendCmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
await sendCmd("Runtime.enable");

const script = `
const invoke = window.__TAURI_INTERNALS__?.invoke;
const out = { hasIpc: !!invoke };
const call = async (name, args) => {
  try { const r = await invoke(name, args); return { ok: true, r: r ?? null }; }
  catch (e) { return { ok: false, e: String(e).slice(0, 300) }; }
};
if (invoke) {
  out.browser_open = await call('browser_open', { url: 'https://example.com', x: 140, y: 140, w: 900, h: 620 });
  await new Promise((r) => setTimeout(r, 2500));
  out.browser_navigate = await call('browser_navigate', { url: 'https://example.org' });
  out.browser_set_bounds = await call('browser_set_bounds', { x: 160, y: 160, w: 880, h: 600 });
  out.browser_show = await call('browser_show', {});
  await new Promise((r) => setTimeout(r, 1500));
  out.browser_hide = await call('browser_hide', {});
  out.overlay_show = await call('overlay_show', { x: 200, y: 200, w: 420, h: 300 });
  await new Promise((r) => setTimeout(r, 1200));
  out.overlay_hide = await call('overlay_hide', {});
  out.hud_open = await call('hud_open', {});
}
return JSON.stringify(out, null, 1);
`;
const res = await sendCmd("Runtime.evaluate", {
  expression: `(async () => { ${script} })()`,
  returnByValue: true,
  awaitPromise: true,
});
if (res.exceptionDetails) {
  console.error("eval failed: " + JSON.stringify(res.exceptionDetails).slice(0, 900));
  process.exit(1);
}
console.log(res.result?.value);
await wait(500);
ws.close();
