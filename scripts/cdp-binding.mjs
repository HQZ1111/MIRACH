// The dsh branch requires chatStyle='dsh' AND nativeDshOk. nativeDshOk set by NativeChatArea onReady(true) — only when nativeRenderReady && mapping && root tree && openSession succeeded. Currently NativeChatArea likely reports false because nativeOpenSession fails or tree is null. The '会话' service issue = uiSession current binding not materializing since sessions.binding(current) has no session yet (materialize needs a session controller binding with actual session object). The controller 'sessionController unavailable' earlier was from session/follow when opening.

// Root cause: Kernel bootstrap opens first session but conversation render may need the browser to select it (sessions.selection.set(current)). After open, snap.current did change (from eb0d01b4 to 0a59b9c3 etc). currentBinding still absent because sessions.binding(current) returns undefined until a session object is materialized — materialize happens on session events arriving (engine pushes). Let's check sessions.binding(sessionId) for current session; and events from engine reachable?
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    const s = c.get('sessions');
    const snap = s.list.getSnapshot();
    const cur = snap.current;
    const out = { cur, curIsObj: typeof cur };
    try {
      const b = s.binding(cur);
      out.binding = b ? JSON.stringify({ keys: Object.keys(b), sessionId: b.sessionId, hasSession: !!b.session }).slice(0, 300) : null;
      out.bindingKeys = b ? Object.keys(b) : null;
    } catch (e) { out.bindingErr = String(e).slice(0, 200); }
    try {
      const scopes = s.scopes;
      out.scopesType = scopes ? (scopes instanceof Map ? 'Map size ' + scopes.size : Object.keys(scopes).length) : null;
    } catch (e) { out.scopeErr = String(e); }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
