// probe10: set dsh style, reload, then full verification incl brand mark + extras + tool rows
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 500);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  console.log("style set:", await rawEval(`(localStorage.setItem('mirach.chatStyle','dsh'), 'ok')`));
  await send("Page.reload", { ignoreCache: true });
  await sleep(18000);
  console.log(await rawEval(`(() => {
    const out = {};
    out.style = localStorage.getItem('mirach.chatStyle');
    out.kernel = !!window.__mirachCtx;
    const convs = [...document.querySelectorAll('[data-slot="conversation"]')].filter(x => !x.closest('[data-kernel-mirror]'));
    out.inlineConv = convs.length;
    if (convs.length) {
      const conv = convs[0];
      const txt = (conv.textContent||'').replace(/\\s+/g,' ');
      out.text = txt.slice(0, 350);
      for (const k of ['conversation.hero.brand.mark','sidebar.brand.mark']) {
        const el = document.querySelector('[data-slot="' + k + '"]');
        out[k] = el ? (el.querySelector('svg') ? 'svg' : 'empty') : 'slot-missing';
      }
      const btnTitles = [...conv.querySelectorAll('button')].map(b => b.getAttribute('title')||'');
      out.hasSpeak = btnTitles.some(t => t.includes('朗读'));
      out.hasTerminal = btnTitles.some(t => t.includes('终端'));
      out.modelSeat = btnTitles.find(t => t.includes('选择模型')) || null;
    }
    return JSON.stringify(out).slice(0, 2200);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
