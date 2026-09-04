// probe: does remote.session have search? + what does current searchSessions call?
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    if (!c) return 'no ctx';
    const out = {};
    // remote namespaces: session should have search methods if session-query is wired
    const remote = c.get('remote');
    const ns = remote.namespaces;
    const sess = ns instanceof Map ? ns.get('session') : ns?.session;
    if (sess) {
      // the mounted contribution wraps a service; inspect its methods
      const svc = sess.service ?? sess;
      out.sessionKeys = Object.keys(svc).filter(k => typeof svc[k] === 'function').sort();
      // look specifically for search
      out.hasSearch = Object.keys(svc).some(k => /search/i.test(k));
      out.searchKeys = Object.keys(svc).filter(k => /search|query|find/i.test(k));
    }
    // also check remote for any query/search namespace we might have missed
    for (const [k, v] of (ns instanceof Map ? ns.entries() : Object.entries(ns ?? {}))) {
      const svc = v?.service ?? v;
      const fns = Object.keys(svc).filter(k2 => typeof svc[k2] === 'function' && /search|query/i.test(k2));
      if (fns.length > 0) out[k + '_searchFns'] = fns;
    }
    return JSON.stringify(out).slice(0, 3000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 30000);
