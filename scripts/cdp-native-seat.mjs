// after NativeModelSeat now shows nativeSeat:true (my edit to direct import DID work via HMR despite tsc complaints!). Dump the official model seat DOM text + structure
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
  console.log(await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat');
    if (!seat) return 'no seat';
    const r = seat.getBoundingClientRect();
    const btn = seat.querySelector('button');
    return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: (btn?.textContent ?? seat.innerText ?? '').slice(0, 120), btnAria: btn?.getAttribute('aria-label'), html: seat.innerHTML.slice(0, 500) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
