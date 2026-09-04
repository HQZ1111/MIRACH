// dsh-probe5: replicate NativeChatArea steps with the APP's ctx (window.__mirachCtx), capture real errors
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 600);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const out = {};
    const c = window.__mirachCtx;
    if (!c) return 'no ctx';
    out.hasSlotsProp = !!c.slots;
    const slots = c.slots;
    out.renderSlotType = typeof slots?.renderSlot;
    // step: sessions
    const ctxAny = c;
    const s = ctxAny.get ? ctxAny.get('sessions') : undefined;
    out.sessionsViaGet = !!s;
    if (!s) return JSON.stringify(out);
    try { await s.refresh(); out.refresh = 'ok'; } catch (e) { out.refreshErr = String(e).slice(0, 200); }
    const dshId = 'dsh-default-cabfefb0';
    try { s.open(dshId); out.open = 'ok'; } catch (e) { out.openErr = String(e).slice(0, 200); }
    await new Promise(r => setTimeout(r, 1200));
    const snap = s.list.getSnapshot();
    out.curNow = typeof snap.current === 'string' ? snap.current.slice(0, 26) : String(snap.current);
    // render root tree with error capture
    try {
      const t = slots.renderSlot('root', {});
      out.treeRendered = t !== null && t !== undefined;
      if (t) out.treeKind = typeof t;
    } catch (e) {
      out.treeRenderErr = String(e && e.message ? e.message : e).slice(0, 400);
    }
    // binding for the dsh session
    const b = s.binding(dshId);
    out.bindingHasSession = b ? !!b.session : 'no-binding';
    if (b && b.eventSource) {
      try {
        const win = b.eventSource.getSnapshot();
        out.eventEntries = (win.entries || []).length;
        out.eventTypes = [...new Set((win.entries || []).map(e => e.event.type))].slice(0, 12);
      } catch (e) { out.srcErr = String(e).slice(0, 150); }
    }
    return JSON.stringify(out).slice(0, 3000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
