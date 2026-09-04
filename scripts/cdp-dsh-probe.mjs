// dsh-probe: switch chatStyle to dsh, reload, dump official conversation render state
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
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // 1) set dsh style
  console.log("setStyle:", await rawEval(`(localStorage.setItem('mirach.chatStyle','dsh'), 'ok')`));
  // 2) reload page
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await sleep(9000);
  // 3) dump state
  console.log(await rawEval(`(async () => {
    const out = {};
    out.style = localStorage.getItem('mirach.chatStyle');
    const c = window.__mirachCtx;
    out.kernel = !!c;
    if (c) {
      try {
        const s = c.get('sessions');
        const snap = s.list.getSnapshot();
        out.cur = typeof snap.current === 'string' ? snap.current.slice(0, 20) : String(snap.current);
        out.ids = (snap.ids || []).length;
        const b = s.binding(snap.current);
        out.bindingSession = b ? !!b.session : null;
        if (b && b.session) {
          out.sessionKeys = Object.keys(b.session).slice(0, 20);
        }
        const u = c.get('uiSession');
        out.uiCur = u && u.currentBinding ? (u.currentBinding.sessionId || '').slice(0, 20) : null;
      } catch (e) { out.sessErr = String(e).slice(0, 150); }
    }
    // native chat area present?
    const nca = document.querySelector('.relative.min-h-0.flex-1');
    out.nativeArea = !!nca;
    // official tree visible? look for conversation slots in MIRROR (rendered inline via NativeChatArea, not in mirror)
    const slots = [...document.querySelectorAll('[data-slot]')].map(e => e.getAttribute('data-slot'));
    out.slotSet = [...new Set(slots)];
    // visible text of the main area
    const main = document.querySelector('[data-panel]');
    out.bodyText = main ? main.innerText.replace(/\\s+/g, ' ').slice(0, 500) : 'no panel';
    return JSON.stringify(out).slice(0, 4000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
