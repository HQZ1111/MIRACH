// Esc to close settings, then verify composer surface usable
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await rawEval(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await sleep(1500);
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const surf = mir?.classList.contains('dsh-settings-surface');
    const seat = document.querySelector('.native-model-seat');
    const ta = [...document.querySelectorAll('textarea')].map(t => t.placeholder);
    return JSON.stringify({ surfaced: !!surf, seat: !!seat, ta: ta.slice(0, 2) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
