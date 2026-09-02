const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const blocks = [...document.querySelectorAll('div,section')].filter(e => /send_message/.test(e.textContent ?? '') && e.textContent.length < 600);
    const last = blocks.at(-1);
    return JSON.stringify({ hit: blocks.length, sample: (last?.textContent ?? '').trim().slice(0, 400) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
