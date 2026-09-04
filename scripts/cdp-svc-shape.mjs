// discover the shape of ctx.sessions + uiSession and how current session opens. sessions IS the session-controller (client service with refresh/list/open).
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
      const s = c.get('sessions');
      out.sessionsProto = Object.getOwnPropertyNames(Object.getPrototypeOf(s));
      out.sessionsOwn = Object.getOwnPropertyNames(s);
    } catch (e) { out.sessions = 'ERR ' + e.message; }
    try {
      const u = c.get('uiSession');
      out.uiProto = Object.getOwnPropertyNames(Object.getPrototypeOf(u));
      out.uiOwn = Object.getOwnPropertyNames(u);
      // maybe snapshot on store binding
      out.uiKeys = Object.keys(u).slice(0, 30);
    } catch (e) { out.ui = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
