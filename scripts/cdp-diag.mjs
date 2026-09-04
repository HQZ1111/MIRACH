// diag: kernel model-seat readiness + settings panel + composer model zone, one shot
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
  console.log(await rawEval(`(async () => {
    const out = {};
    const c = window.__mirachCtx;
    out.kernel = !!c;
    try {
      const tModel = (() => {
        const ctxAny = c;
        const locale = (typeof ctxAny.get === 'function' ? ctxAny.get('locale') : undefined) ?? ctxAny.locale;
        return typeof locale?.bind === 'function' ? typeof locale.bind('model') === 'function' : false;
      })();
      out.tModelFn = tModel;
    } catch (e) { out.tModelErr = String(e).slice(0,200); }
    // model directory snapshot
    try {
      const s = c.get('sessions');
      const snap = s.list.getSnapshot();
      out.snapKeys = Object.keys(snap).slice(0, 20);
      out.current = typeof snap.current;
      out.idsLen = (snap.ids ?? snap.sessions ?? []).length;
      out.bindingHasSession = s.binding(snap.current) ? !!s.binding(snap.current).session : null;
    } catch (e) { out.sessErr = String(e).slice(0,300); }
    // mirror + composer model zone
    const mir = document.querySelector('[data-kernel-mirror]');
    out.mirrorOpacity = mir ? getComputedStyle(mir).opacity : null;
    out.mirrorInert = mir ? mir.inert : null;
    const seat = document.querySelector('.native-model-seat');
    out.nativeSeat = seat ? { text: seat.innerText.slice(0,120), html: seat.innerHTML.slice(0,200) } : null;
    // mirach composer: buttons near bottom (model/mode/plus)
    const btn = [...document.querySelectorAll('button')].map(b => {
      const r = b.getBoundingClientRect();
      const txt = (b.textContent ?? '').trim().slice(0,40);
      return { txt, y: Math.round(r.y), x: Math.round(r.x), title: (b.getAttribute('title')||'').slice(0,30), aria: (b.getAttribute('aria-label')||'').slice(0,30) };
    }).filter(b => b.y > 700 && b.x < 1600);
    out.bottomButtons = btn.slice(0, 30);
    return JSON.stringify(out, null, 0).slice(0, 4000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
