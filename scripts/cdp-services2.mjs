// check services on live ctx (browser-safe)
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
    if (!c) return { err: "no ctx" };
    const deps = ["slots","sessions","uiSession","uiWorkspace","locale","settingsScope","commandUi","modelDirectories","inputTriggers"];
    const out = {};
    for (const d of deps) {
      let v = "missing";
      try { if (c.get && c.get(d) !== undefined) v = "get:ok"; } catch (e1) {}
      try { if (v === "missing" && c[d] !== undefined) v = "prop:ok"; } catch (e2) {}
      out[d] = v;
    }
    return out;
  })()`)));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
