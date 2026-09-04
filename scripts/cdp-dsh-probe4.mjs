// dsh-probe4: did NativeChatArea mount? why fallback still showing — trace tryLoad steps manually
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
    const boot = await import('/src/dsh-kernel/boot.ts');
    const T = window.__TAURI_INTERNALS__;
    out.renderReady = boot.nativeRenderReady();
    // active session id: read from sessions store via module import
    try {
      const sess = await import('/src/store/session.ts');
      const activeId = sess.$activeSessionId.get();
      out.activeId = String(activeId).slice(0, 30);
      const apiMod = await import('/src/lib/api/index.ts');
      const api = apiMod.getApi();
      out.dshMapped = await api.getDshSessionId(activeId);
    } catch (e) { out.storeErr = String(e).slice(0, 200); }
    // kernel sessions current
    const c = window.__mirachCtx;
    const s = c && c.get('sessions');
    if (s) {
      const snap = s.list.getSnapshot();
      out.kernelCur = typeof snap.current === 'string' ? snap.current.slice(0, 26) : String(snap.current);
      const b = s.binding(snap.current);
      out.kernelBindingHasSession = b ? !!b.session : null;
    }
    // root tree renderable?
    try {
      const t = boot.nativeRootTree();
      out.treeNonNull = t !== null && t !== undefined;
    } catch (e) { out.treeErr = String(e).slice(0, 150); }
    // NativeChatArea module mounted? check whether the fallback (ChatSection textarea) visible
    const ta = document.querySelectorAll('textarea');
    out.textareaCount = ta.length;
    return JSON.stringify(out).slice(0, 2500);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
