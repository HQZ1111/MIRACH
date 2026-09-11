// _hud_skin_recon.mjs — HUD 三处细看：对话区每行的类型/文字、输入条内部盒子、右侧图标
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
  const out = [];
  const rect = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(','); };
  const brief = (el) => {
    const attrs = [...el.attributes].map(a => a.name + '=' + a.value).filter(a => !a.startsWith('class=') && !a.startsWith('style=')).slice(0, 4).join(' ');
    const cls = String(el.className || '').split(/\\s+/).slice(0, 2).join('.');
    return el.tagName.toLowerCase() + (attrs ? ' [' + attrs + ']' : '') + (cls ? ' .' + cls : '') + ' ' + rect(el);
  };

  // 1) 对话区每一行（官方 chat.node 的外层 flowItem）：类型标记 + 文字前缀
  out.push('=== band rows ===');
  const content = document.querySelector('[data-hud-slot~="aui_thread-content"]');
  if (content) {
    const rows = [...content.children].slice(-8);
    for (const row of rows) {
      const node = row.querySelector('[data-slot="conversation.chat.node"]') || row;
      const inner = node.firstElementChild ? brief(node.firstElementChild) : '(no child)';
      const text = (node.textContent || '').replace(/\\s+/g, ' ').slice(0, 70);
      const bg = getComputedStyle(row).backgroundColor;
      out.push('row ' + rect(row) + ' bg=' + bg + ' | inner: ' + inner + ' | "' + text + '"');
    }
  } else out.push('(no thread content)');

  // 2) 输入条内部盒子（卡片 → 行 → 图标）
  out.push('');
  out.push('=== composer boxes ===');
  const card = document.querySelector('[class*="_pa_card"]');
  if (card) {
    out.push('card ' + brief(card) + ' bg=' + getComputedStyle(card).backgroundColor);
    for (const child of card.children) {
      out.push('  child ' + brief(child) + ' bg=' + getComputedStyle(child).backgroundColor + ' disp=' + getComputedStyle(child).display);
    }
    const btns = [...card.querySelectorAll('button')].slice(0, 10);
    for (const b of btns) {
      const cs = getComputedStyle(b);
      out.push('  button "' + (b.getAttribute('aria-label') || b.title || b.textContent || '').trim().slice(0, 24) + '" ' + rect(b) +
        ' bg=' + cs.backgroundColor + ' color=' + cs.color + ' radius=' + cs.borderRadius + ' op=' + cs.opacity);
    }
  } else out.push('(no card)');

  // 3) 对话区文字颜色（首行/末行）
  out.push('');
  out.push('=== ink ===');
  const band = document.querySelector('[data-hud-slot~="composer-bounds"]');
  if (band) {
    out.push('band color=' + getComputedStyle(band).color + ' op=' + getComputedStyle(band).opacity + ' bg=' + getComputedStyle(band).backgroundColor);
    const firstText = [...band.querySelectorAll('p, span, div')].find(el => (el.textContent || '').trim().length > 3 && el.children.length === 0);
    if (firstText) out.push('sample text el: ' + brief(firstText) + ' color=' + getComputedStyle(firstText).color + ' fs=' + getComputedStyle(firstText).fontSize);
  }
  return out.join('\\n');
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 400) : res.result?.value);
ws.close();
