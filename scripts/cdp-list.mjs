// understand sessions.list shape (it may be a reactive atom w/ get). Also current selection empty {}. Why no session selected? boot opens first session via nativeOpenSession? In NativeChatArea we call nativeOpenSession(dshId). But current mirror default state has no current. In the default (mirach shell), ChatSection uses its OWN store (session-chat). The kernel 'current' only becomes set when NativeChatArea path is used (chatStyle=dsh). So for dsh style we open session then follow current.

// Probe sessions.list: keys + how to read list & refresh
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
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const c = window.__mirachCtx;
    const out = {};
    try {
      const s = c.get('sessions');
      const l = s.list;
      out.listType = typeof l;
      if (l && typeof l.get === 'function') out.listGet = JSON.stringify(l.get()).slice(0, 600);
      else if (l && typeof l.getSnapshot === 'function') out.listGet = JSON.stringify(l.getSnapshot()).slice(0, 600);
      else out.listKeys = Object.keys(l || {}).slice(0, 20);
    } catch (e) { out.sess = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
