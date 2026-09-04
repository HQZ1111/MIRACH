// inspect kernel mirror for the official composer + model seats binding
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 500) };
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    if (!mir) return 'no mirror';
    const slots = [...mir.querySelectorAll('[data-slot]')].map(e => e.getAttribute('data-slot'));
    const uniq = [...new Set(slots)];
    // official composer card?
    const card = mir.querySelector('[data-composer-card]');
    const cardInfo = card ? { rect: (() => { const r = card.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(), text: card.innerText.slice(0, 120) } : null;
    // model seat in mirror?
    const modelSeat = [...mir.querySelectorAll('*')].find(e => (e.className ?? '').toString().includes('ModelSelect') || (e.getAttribute('data-model-seat') !== null));
    return JSON.stringify({ uniqSlots: uniq, cardInfo, modelSeat: modelSeat ? { cls: (modelSeat.className ?? '').toString().slice(0, 60), text: modelSeat.innerText.slice(0, 120) } : null });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
