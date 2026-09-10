// _pluginbar_check.mjs — 主窗顶栏插件图标条：读每个插件的缩写徽标与提示
const PORT = Number(process.argv[2] || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !(t.url || "").includes("win="));
if (!page) {
  console.error("no main target: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
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
const expression = `(async () => {
  const btns = [...document.querySelectorAll('button[title]')].filter((b) => /点击打开插件面板/.test(b.title));
  const glyphs = btns.map((b) => {
    const span = b.querySelector('span');
    const style = span ? getComputedStyle(span) : null;
    return { title: b.title, glyph: (span?.textContent || '').trim(), color: style?.color || '' };
  });
  const overflow = [...document.querySelectorAll('button[title]')].filter((b) => /更多插件/.test(b.title)).length;
  return JSON.stringify({ count: glyphs.length, overflow, glyphs }, null, 1);
})()`;
const res = await sendCmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (res.exceptionDetails) {
  console.error("eval failed: " + JSON.stringify(res.exceptionDetails).slice(0, 600));
  process.exit(1);
}
console.log(res.result?.value);
ws.close();
