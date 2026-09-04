// list snapshot has .current (probably selected current session object) + ids + byId. Read .current + how open is invoked. sessions.open likely takes sessionId string from the ids list. earlier open(session-eb0d01b4..) worked? it did set selected to eb0d01b4! then later selections changed to 0a59b9c3 (someone auto-selected after?). current might hold selected id or the object.
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
    const out = { current: JSON.stringify(snap.current).slice(0, 200), curKeys: snap.current ? Object.keys(snap.current) : null };
    // choose a NON-blank session with history: dsh-main-eec11a85 was main. try open by id string via manager
    try {
      const mgr = s.manager;
      out.mgrHasOpen = typeof s.open === 'function';
      // find eligible non-blank
      const cand = snap.ids.find(id => snap.byId[id] && snap.byId[id].blank !== true);
      out.cand = cand;
      if (cand) { await s.open(cand); out.opened = cand; }
    } catch (e) { out.openErr = String(e).slice(0, 300); }
    return JSON.stringify(out);
  })()`));
  await sleep(12000);
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    const s = c.get('sessions');
    const u = c.get('uiSession');
    const snap = s.list.getSnapshot();
    const out = { current: JSON.stringify(snap.current).slice(0, 160), curId: snap.current?.sessionId || snap.current?.id || null };
    try { out.uiCur = u.currentBinding ? JSON.stringify({ id: u.currentBinding.id, hasSession: !!u.currentBinding.session }) : null; } catch {}
    const mir = document.querySelector('[data-kernel-mirror]');
    out.mirrorText = (mir?.innerText ?? '').slice(0, 240);
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
