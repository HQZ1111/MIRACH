// boot opens first session itself (sessions.open(first)) — so a session SHOULD be current. Yet our probe found selection empty {} and currentBinding.session null. Maybe open raced before engine follow ready. Let's call refresh + open on a REAL dsh id from list then re-read currentBinding.
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
      await s.refresh();
      const ids = s.list.getSnapshot().ids;
      out.count = ids.length;
      out.ids0 = ids.slice(0, 3);
      const first = ids[0];
      try { await s.open(first); out.openedFirst = first; } catch (e) { out.openErr = String(e).slice(0, 200); }
    } catch (e) { out.err = String(e).slice(0, 300); }
    return JSON.stringify(out);
  })()`));
  await sleep(8000);
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    const u = c.get('uiSession');
    const s = c.get('sessions');
    const out = {};
    try { out.sel = JSON.stringify(s.selection).slice(0, 200); } catch (e) { out.selE = String(e); }
    try { out.cur = u.currentBinding ? JSON.stringify({ id: u.currentBinding.id, hasSession: !!u.currentBinding.session }) : null; } catch (e) { out.uiE = String(e); }
    const mir = document.querySelector('[data-kernel-mirror]');
    out.mirrorText = (mir?.innerText ?? '').slice(0, 160);
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
