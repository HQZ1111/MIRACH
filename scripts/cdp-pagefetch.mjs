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
  console.log(await evalJs(`(async () => {
    const r = await fetch('/dsh-pocket/pocket.status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'probe1', method: 'pocket.status', payload: { args: {} } }),
    });
    const text = await r.text();
    return JSON.stringify({ status: r.status, body: text.slice(0, 200) });
  })()`));
  // 对照：document.cookie 里有没有同名冲突
  console.log(await evalJs(`JSON.stringify({ cookies: document.cookie.slice(0, 200) })`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
