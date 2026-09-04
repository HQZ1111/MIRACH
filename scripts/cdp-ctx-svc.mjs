// probe what session services exist on live ctx: uiSession / sessions binding / current session open etc.
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
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    if (!c) return 'no ctx';
    const out = {};
    for (const k of ['sessions','uiSession','workspaces','conversation','commandUi','settingsScope','modelDirectories','connection']) {
      try { const v = c.get ? c.get(k) : undefined; out[k] = v ? 'present:' + (typeof v) : 'missing'; } catch (e) { out[k] = 'ERR'; }
    }
    // uiSession snapshot current
    try {
      const ui = c.get('uiSession');
      out.uiSnap = JSON.stringify(ui ? ui.getSnapshot() : null).slice(0, 400);
    } catch (e) { out.uiSnap = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
