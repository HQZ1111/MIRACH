// final-runtime: plugin fails, slot keys, locale namespaces, service faces on live kernel
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const c = window.__mirachCtx;
    if (!c) return 'no ctx';
    const out = {};
    // services present
    for (const k of ['sessions','uiSession','workspaces','conversation','commandUi','modelDirectories','locale','connection']) {
      try { out[k] = c.get(k) ? 'ok' : 'missing'; } catch { out[k] = 'err'; }
    }
    // slots
    const slots = c.slots;
    out.slotCount = slots ? Object.keys(slots).length : 0;
    // key slot entries
    const counts = {};
    for (const k of ['root','conversation','conversation.composer.bar','conversation.input.right','settings.section','sidebar','details']) {
      try { counts[k] = (slots.entries ? slots.entries(k) : slots.entriesOfSlot ? slots.entriesOfSlot(k) : []).length; } catch { counts[k] = 'err'; }
    }
    out.slotEntries = counts;
    // locale namespaces bound-able
    const locale = c.get('locale');
    const ns = ['model','plan','permission','command','settings','chat','trajectory','jobs','goal','approval','attachment','tool','skill','subagent','deliverables','workflow','workspace','session','schedule','reference','brand','layout'];
    const bound = {};
    for (const n of ns) { try { bound[n] = typeof locale.bind(n) === 'function' ? 'ok' : 'none'; } catch { bound[n] = 'err'; } }
    out.localeMissing = Object.entries(bound).filter(([,v]) => v !== 'ok').map(([k]) => k + ':' + v);
    out.localeOk = Object.values(bound).filter(v => v === 'ok').length;
    return JSON.stringify(out).slice(0, 2000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
