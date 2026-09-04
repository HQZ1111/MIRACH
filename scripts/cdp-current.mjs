// uiSession.currentBinding / sessions.current — dump current session to know why conversation says service unavailable
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
    const out = {};
    try {
      const u = c.get('uiSession');
      out.currentBinding = JSON.stringify(u.currentBinding ? { keys: Object.keys(u.currentBinding).slice(0, 12), id: u.currentBinding?.id, session: u.currentBinding?.session ? Object.keys(u.currentBinding.session).slice(0, 15) : null } : null).slice(0, 800);
      out.absent = u.absent ? JSON.stringify(u.absent).slice(0, 200) : null;
    } catch (e) { out.ui = 'ERR ' + e.message; }
    try {
      const s = c.get('sessions');
      out.sel = JSON.stringify(s.selection).slice(0, 300);
      out.listHead = JSON.stringify(s.list && s.list.getSnapshot ? s.list.getSnapshot().slice(0, 3) : (Array.isArray(s.list) ? s.list.slice(0,3) : null)).slice(0, 400);
    } catch (e) { out.sess = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
