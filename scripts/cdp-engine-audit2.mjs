// engine-audit2: inspect the remote carrier's mounted namespaces + sample real calls
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
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    const ctxAny = c;
    const remote = (typeof ctxAny.get === 'function' ? ctxAny.get('remote') : undefined) ?? ctxAny.remote;
    const out = {};
    const ns = remote.namespaces;
    out.nsType = ns ? (ns instanceof Map ? 'Map' + ns.size : typeof ns) : 'null';
    if (ns instanceof Map) out.nsKeys = [...ns.keys()].sort();
    else if (ns && typeof ns === 'object') out.nsKeys = Object.keys(ns).sort();
    // sample: session namespace calls through official remote
    async function sample(desc, fn) {
      try { const r = await fn(); return desc + ' = ' + JSON.stringify(r).slice(0, 140); }
      catch (e) { return desc + ' ERR ' + String(e && e.message ? e.message : e).slice(0, 110); }
    }
    const get = (name) => (ns instanceof Map ? ns.get(name) : ns ? ns[name] : undefined);
    const sess = get('session');
    out.sessionFns = sess ? Object.keys(sess).slice(0, 18) : null;
    if (sess && typeof sess.modelCatalog === 'function') {
      out.modelCatalog = await sample('modelCatalog', () => sess.modelCatalog());
    }
    return JSON.stringify(out).slice(0, 3000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
