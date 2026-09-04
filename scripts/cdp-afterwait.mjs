// A session (session-eb0d01b4...) is being followed (tavern memory queries hit it). The kernel uiSession current binding may need a tick to materialize. Wait longer + dump mirror text + errors panel + whether conversation section shows.
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
  await sleep(10000);
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    const u = c.get('uiSession');
    const s = c.get('sessions');
    const out = {};
    try { out.sel = JSON.stringify(s.selection).slice(0, 300); } catch (e) { out.selE = String(e); }
    try { out.cur = u.currentBinding ? JSON.stringify({ id: u.currentBinding.id, hasSession: !!u.currentBinding.session, snapKeys: u.currentBinding.session ? Object.keys(u.currentBinding.session) : null }) : null; } catch (e) { out.uiE = String(e); }
    const mir = document.querySelector('[data-kernel-mirror]');
    out.mirrorLen = mir ? mir.innerText.length : -1;
    out.mirrorText = (mir?.innerText ?? '').slice(0, 400);
    // error nodes in mirror?
    const errs = mir ? [...mir.querySelectorAll('[class*="error"], [role="alert"]')].map(e => e.innerText.slice(0, 80)) : [];
    out.errs = errs.slice(0, 4);
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
