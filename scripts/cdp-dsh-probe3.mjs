// dsh-probe3: why is nativeDshOk false — replicate NativeChatArea.tryLoad steps
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
    const out = {};
    const T = window.__TAURI_INTERNALS__;
    out.hasTauri = !!T;
    // active mirach session id: read from the mirach UI state via tauri? Instead read localStorage session store
    // mirach persists active session? check known keys
    const keys = Object.keys(localStorage).filter(k => /session|chat/i.test(k)).slice(0, 20);
    out.keys = keys;
    // try invoke via internals
    if (T && T.invoke) {
      try {
        const r = await T.invoke('dsh_rpc', { method: 'session.map.get', params: { sessionId: 'probe' } });
        out.mapProbe = JSON.stringify(r).slice(0, 200);
      } catch (e) { out.mapProbeErr = String(e).slice(0, 200); }
      try {
        const r2 = await T.invoke('dsh_list_sessions', {});
        out.listType = Array.isArray(r2) ? ('array len ' + r2.length) : typeof r2;
      } catch (e) { out.listErr = String(e).slice(0, 150); }
    }
    // kernel render ready?
    const c = window.__mirachCtx;
    const s = c && c.get('sessions');
    out.renderReady = !!(c && s && typeof c.slots?.renderSlot === 'function');
    // root tree via kernel
    if (c && c.slots && typeof c.slots.renderSlot === 'function') {
      try {
        const tree = c.slots.renderSlot('root', {});
        out.treeType = tree ? (typeof tree) : 'null';
      } catch (e) { out.treeErr = String(e).slice(0, 150); }
    }
    return JSON.stringify(out).slice(0, 3000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
