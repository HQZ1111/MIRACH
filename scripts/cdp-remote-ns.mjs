// list remote namespaces from live ctx
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(JSON.stringify(await evalJs(`(() => {
    const c = window.__mirachCtx;
    const remote = c.get ? c.get("remote") : undefined;
    if (!remote) return { err: "no remote" };
    const out = { keys: [] };
    try { out.keys = Object.keys(remote).slice(0, 40); } catch (e) { out.keys = "ERR " + e.message; }
    try { out.namespaces = JSON.stringify(remote.namespaces ?? remote.get?.("namespaces") ?? null).slice(0, 400); } catch (e) { out.namespaces = "ERR"; }
    for (const n of ["session", "workspace", "directoryPicker", "subagents", "settings"]) {
      try { out[n] = typeof remote[n] === "object" && remote[n] !== null ? "obj:" + Object.keys(remote[n]).length : String(remote[n]); } catch (e) { out[n] = "ERR"; }
    }
    return out;
  })()`)));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
