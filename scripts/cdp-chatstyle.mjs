// chatStyle default currently uses mirach Composer. Verify by clicking the conversation composer area: does mirach Composer textarea exist at viewport? Then check settings localStorage hermes.chatStyle value.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? 'ERR';
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const keys = Object.keys(localStorage);
    const chatStyle = localStorage.getItem('hermes.chatStyle') || localStorage.getItem('mirach.chatStyle') || 'n/a';
    const ta = [...document.querySelectorAll('textarea')].map(t => ({ ph: t.placeholder, x: Math.round(t.getBoundingClientRect().x), y: Math.round(t.getBoundingClientRect().y) }));
    const compCard = document.querySelector('[data-composer-card]');
    const nativeSeat = document.querySelector('.native-model-seat');
    return JSON.stringify({ chatStyle, textareas: ta.slice(0, 4), officialCard: !!compCard, nativeSeat: !!nativeSeat, keys: keys.filter(k => /chat|style/i.test(k)) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
