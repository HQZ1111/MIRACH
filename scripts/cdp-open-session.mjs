// Sessions list HAS ids (kernel loaded history). "sessionController unavailable" came from typert gateway session/follow — follow only runs when opening a session. So open one session and see what the conversation area shows + whether errors surface.
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
    const out = {};
    try {
      const l = s.list.get();
      out.id0 = l.ids[0];
      out.first = JSON.stringify(l.byId ? l.byId[l.ids[0]] : null).slice(0, 400);
    } catch (e) { out.read = 'ERR ' + e.message; }
    try {
      const ok = await s.open(out.id0);
      out.opened = String(ok);
    } catch (e) { out.open = 'ERR ' + e.message; }
    return JSON.stringify(out);
  })()`));
  await sleep(6000);
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    const u = c.get('uiSession');
    const out = {};
    try { out.currentBinding = u.currentBinding ? JSON.stringify({ id: u.currentBinding.id, hasSession: !!u.currentBinding.session, hooks: Object.keys(u.currentBinding.hooks || {}) }).slice(0, 400) : null; } catch (e) { out.ui = 'ERR ' + e.message; }
    const mir = document.querySelector('[data-kernel-mirror]');
    out.bodyText = (mir?.innerText ?? '').slice(0, 300);
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
