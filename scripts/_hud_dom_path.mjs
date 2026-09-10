// _hud_dom_path.mjs — 从 HUD 的官方 frame 走到输入框，打印每一层的 data-slot/class/rect（给 CSS 选型用）
const PORT = Number(process.argv[2] || 9222);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
const target = list.find((t) => (t.url || "").includes("win=hud"));
if (!target) {
  console.error("no hud target");
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

const expr = `(() => {
  const desc = (el) => {
    if (!el || !el.getAttribute) return '?';
    const r = el.getBoundingClientRect();
    const slot = el.getAttribute('data-slot');
    const cls = String(el.className || '').split(/\\s+/).slice(0, 3).join(' ');
    const vis = r.width > 0 && r.height > 0 ? 'VIS' : 'hid';
    return (el.tagName.toLowerCase()) + (slot ? '[' + slot + ']' : '') + ' .' + cls + ' ' + vis + ' ' +
      [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',');
  };
  // 可见的输入框
  const inputs = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
    .filter((el) => el.getBoundingClientRect().width > 0);
  const out = { visibleInputs: inputs.length, paths: [] };
  for (const inp of inputs.slice(0, 2)) {
    const path = [];
    let el = inp;
    for (let i = 0; i < 14 && el && el !== document.body; i += 1) {
      path.push(desc(el));
      el = el.parentElement;
    }
    out.paths.push(path);
  }
  // 可见的 data-slot 元素（去重后前 30 个）
  const visSlots = [...document.querySelectorAll('[data-slot]')]
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => el.getAttribute('data-slot') + ' ' +
      [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y),
       Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)].join(','));
  out.visibleSlots = [...new Set(visSlots)];
  // 隐藏大树的根：rect 全 0 的 [data-slot="root"]
  const roots = [...document.querySelectorAll('[data-slot="root"]')].map((el) => {
    const r = el.getBoundingClientRect();
    return desc(el) + ' parentChain=' + [el.parentElement, el.parentElement?.parentElement]
      .map((p) => p ? (p.tagName.toLowerCase() + '.' + String(p.className || '').split(/\\s+/)[0]) : '-').join(' > ');
  });
  out.roots = roots;
  return JSON.stringify(out, null, 1);
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 500) : res.result?.value);
ws.close();
