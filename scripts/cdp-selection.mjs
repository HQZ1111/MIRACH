// uiSession.currentBinding is null-ish; the conversation session materialization maybe deferred until a ConversationRoot is MOUNTED (its effect calls materialize). The kernel mirror ConversationRoot IS mounted (empty state because no current binding). Follows: opening session set selection {} — sessions.selection is a store of selected ids, maybe .get() returns the object. read .selection properly.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
    const sel = s.selection;
    out.selType = typeof sel;
    if (sel) {
      out.selKeys = Object.keys(sel);
      for (const k of Object.keys(sel)) {
        try { out['sel.'+k] = typeof sel[k] === 'function' ? 'fn' : JSON.stringify(sel[k]).slice(0,120); } catch {}
      }
    }
    out.managerKeys = s.manager ? Object.keys(s.manager) : null;
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
