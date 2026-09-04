// list official UI slots the current LIVE page declares (both kernel mirror and web) that mirach NativeChatArea tree fills
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? "ERR";
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const slots = [...document.querySelectorAll('[data-slot]')].map(e => e.getAttribute('data-slot'));
    const uniq = [...new Set(slots)].sort();
    // view selectors in header / toolbars / chat
    const btnTxt = [...document.querySelectorAll('button')].map(b => (b.textContent||'').trim()).filter(Boolean).slice(0, 60);
    return JSON.stringify({ slots: uniq, btns: btnTxt });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
