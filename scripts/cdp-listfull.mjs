// sessions.open expects id string but selection stores an OBJECT {sessionId}. manager.selected is the same object. The controller open(selection.sessionId). But our earlier direct s.open('session-...') also failed "unknown session undefined". Check manager list items shape + open signature: open probably accepts sessionId string but needs session in list. Let's inspect s.list.getSnapshot() fully + manager.list items keys, then open using sessions.manager?.sessions or sessions.open(sessionId) with a session ACTUALLY in the current manager items (maybe the earlier id wasn't current list).
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
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    const s = c.get('sessions');
    const out = {};
    try {
      const snap = s.list.getSnapshot();
      out.snapKeys = Object.keys(snap);
      out.first = JSON.stringify(snap.ids ? snap.ids.slice(0,2) : null);
      const byId0 = snap.byId ? snap.byId[snap.ids[0]] : null;
      out.byId0Keys = byId0 ? Object.keys(byId0).slice(0, 20) : null;
      out.byId0 = JSON.stringify(byId0).slice(0, 500);
    } catch (e) { out.err = String(e); }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
