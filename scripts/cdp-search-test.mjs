// probe: call remote.session.search to see signature + response shape
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 600);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    const remote = c.get('remote');
    const ns = remote.namespaces;
    const sess = ns instanceof Map ? ns.get('session') : ns?.session;
    const svc = sess?.service ?? sess;
    if (!svc?.search) return 'no search fn';
    const out = {};
    // try a simple search
    try {
      const r = await svc.search({ query: '工作' });
      out.simpleResult = JSON.stringify(r).slice(0, 500);
    } catch (e) { out.simpleErr = String(e && e.message ? e.message : e).slice(0, 300); }
    // try with explicit params
    try {
      const r2 = await svc.search({ query: '工作', limit: 5 });
      out.limitedResult = JSON.stringify(r2).slice(0, 500);
    } catch (e) { out.limitedErr = String(e && e.message ? e.message : e).slice(0, 300); }
    // try sessionSearch variant if exists
    try {
      const r3 = await svc.search({ query: 'mirach', mode: 'session' });
      out.sessionMode = JSON.stringify(r3).slice(0, 300);
    } catch (e) { out.sessionModeErr = String(e && e.message ? e.message : e).slice(0, 200); }
    return JSON.stringify(out).slice(0, 3000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 30000);
