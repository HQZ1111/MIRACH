// _hud_official_tree.mjs — 把 HUD 里官方对话面的 composer / thread 子树连 slot+class+rect 打出来
// 目的：把 hermes 那 22 个 slot 名映射到官方 DOM（conversation.*）上时有据可依
const PORT = Number(process.argv[2] || 9222);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
const target = list.find((t) => (t.url || "").includes("win=hud"));
if (!target) {
  console.error("no hud target: " + JSON.stringify(list.map((t) => t.url)));
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

const expr = `(() => {
  const out = [];
  const desc = (el, d) => {
    const r = el.getBoundingClientRect();
    const slot = el.getAttribute('data-slot');
    const cls = String(el.className || '').split(/\\s+/).filter((c) => c && !/^(flex|relative|absolute|min-|overflow|w-|h-|bg-|text-|rounded|px-|py-|p-|m-|gap-|items-|justify-|shrink|grow|border|hidden|block|inline|z-)/.test(c)).slice(0, 3).join(' ');
    const cs = getComputedStyle(el);
    const own = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? ' bg=' + cs.backgroundColor : '';
    const scroll = cs.overflowY !== 'visible' ? ' ovY=' + cs.overflowY : '';
    const editable = el.getAttribute('contenteditable') ? ' contenteditable=' + el.getAttribute('contenteditable') : '';
    const vis = r.width > 0 && r.height > 0 ? '' : ' [0x0]';
    return '  '.repeat(d) + el.tagName.toLowerCase() + (slot ? '[' + slot + ']' : '') + (cls ? ' .' + cls : '') +
      ' ' + [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(',') + own + scroll + editable + vis;
  };
  const walk = (el, d, maxD) => {
    if (d > maxD) return;
    out.push(desc(el, d));
    const kids = [...el.children];
    for (const k of kids.slice(0, 12)) walk(k, d + 1, maxD);
    if (kids.length > 12) out.push('  '.repeat(d + 1) + '… +' + (kids.length - 12) + ' more');
  };
  const conv = document.querySelector('.dsh-native-area [data-slot="conversation"]');
  if (!conv) return JSON.stringify({ error: 'no conversation' });
  out.push('=== conversation 子树 ===');
  walk(conv, 0, 7);
  const comp = document.querySelector('.dsh-native-area [data-slot="conversation.composer"]');
  const view = document.querySelector('.dsh-native-area [data-slot="conversation.view"]');
  out.push('\\n=== composer 子树（bar/card/input/dock 定位用）===');
  if (comp) walk(comp, 0, 8);
  out.push('\\n=== view 子树（band/viewport/content 定位用）===');
  if (view) walk(view, 0, 5);
  return out.join('\\n');
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 400) : res.result?.value);
ws.close();
