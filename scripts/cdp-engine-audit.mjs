// engine-audit: which remote namespaces (engine service faces) does the kernel see, and do sample RPCs answer?
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
    if (!c) return 'no ctx';
    const out = {};
    const ctxAny = c;
    const remote = (typeof ctxAny.get === 'function' ? ctxAny.get('remote') : undefined) ?? ctxAny.remote;
    out.remoteType = typeof remote;
    out.namespaces = remote ? Object.keys(remote).sort() : null;
    // sample calls through the kernel (same faces official UI consumes)
    async function tryCall(ns, fn, args) {
      try {
        const obj = remote?.[ns];
        if (!obj || typeof obj[fn] !== 'function') return 'no-fn';
        const r = await obj[fn](...(args || []));
        return JSON.stringify(r).slice(0, 160);
      } catch (e) { return 'ERR ' + String(e && e.message ? e.message : e).slice(0, 120); }
    }
    out.jobsList = await tryCall('jobs', 'list');
    out.deliverables = await tryCall('deliverables', 'list');
    out.feedback = await tryCall('feedback', 'list');
    out.workflow = await tryCall('workflowRuns', 'list') ?? await tryCall('workflow', 'list');
    out.userQuestions = await tryCall('userQuestions', 'list') ?? await tryCall('questions', 'list');
    out.cordisPluginEntries = await tryCall('config', 'pluginEntries');
    return JSON.stringify(out).slice(0, 4000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
