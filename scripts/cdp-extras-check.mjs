// final: verify mirach extras buttons inside official composer toolbar
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const convs = [...document.querySelectorAll('[data-slot="conversation"]')].filter(c => !c.closest('[data-kernel-mirror]'));
    if (convs.length === 0) return 'no inline conv';
    const conv = convs[0];
    const btns = [...conv.querySelectorAll('button')].map(b => ({ title: b.getAttribute('title'), aria: b.getAttribute('aria-label'), txt: (b.textContent||'').trim().slice(0,20) }));
    return JSON.stringify({
      speak: btns.filter(b => (b.title||'').includes('朗读')),
      terminal: btns.filter(b => (b.title||'').includes('终端')),
      modelSeat: btns.filter(b => (b.aria||'').includes('模型') || (b.aria||'').includes('选择模型')),
      officialRows: (conv.textContent||'').includes('系统提示词') && (conv.textContent||'').includes('上下文注入'),
      viewSwitcher: /对话轨迹|轨迹/.test((conv.textContent||'').slice(0, 30)),
    }).slice(0, 1200);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
