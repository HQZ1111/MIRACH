// dsh-probe6: is the NEW NativeChatArea/MainPanel code actually served & mounted?
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
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const out = {};
    const r1 = await fetch('/src/components/chat/NativeChatArea.tsx');
    const t1 = await r1.text();
    out.ncaHasFallback = t1.includes('fallback');
    out.ncaHasBind = t1.includes('bindEngineSession');
    out.ncaStatus = r1.status;
    const r2 = await fetch('/src/components/layout/MainPanel.tsx');
    const t2 = await r2.text();
    out.mpHasFallbackProp = t2.includes('fallback={mirachChat}');
    out.mpHasNativeDshOk = t2.includes('nativeDshOk');
    // page performance entries: when did the page load?
    const nav = performance.getEntriesByType('navigation')[0];
    out.pageLoadedAt = nav ? new Date(Date.now() - nav.loadEventEnd).toISOString() : null;
    out.docReadyState = document.readyState;
    return JSON.stringify(out).slice(0, 1500);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
