// check nativeModelSeat availability + model directory in live page
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 500) };
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log("seat check:", await evalJs(`(async () => {
    try {
      const m = await import("/src/dsh-kernel/boot.ts");
      const seat = m.nativeModelSeat();
      return JSON.stringify({ hasSeat: !!seat, hasCtx: !!m.kernelContext() });
    } catch (e) { return "ERR " + e.message; }
  })()`));
  console.log("directory:", await evalJs(`(async () => {
    try {
      const m = await import("/src/lib/native-model.ts");
      await m.loadNativeModelCatalog();
      const st = m.modelDirectoryStore().getSnapshot();
      return JSON.stringify({ status: st.status, error: st.error, current: st.current, groups: st.groups.map(g => ({ provider: g.provider, label: g.label ?? g.provider, models: (g.models ?? []).map(x => x.model ?? x.id).slice(0, 6) })), failures: (st.failures ?? []).slice(0, 3) });
    } catch (e) { return "ERR " + e.message; }
  })()`));
  console.log("ctx catalyst:", await evalJs(`(() => {
    const c = window.__mirachCtx;
    if (!c) return "no ctx";
    try {
      const remotes = c.get ? c.get("remote") : undefined;
      const keys = remotes ? Object.keys(remotes).slice(0, 30) : null;
      return JSON.stringify({ remoteKeys: keys });
    } catch (e) { return "ERR " + e.message; }
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
