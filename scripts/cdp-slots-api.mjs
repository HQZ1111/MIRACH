// examine slots api on live ctx
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
  console.log("slots api:", await evalJs(`(() => {
    const c = window.__mirachCtx;
    const s = c.slots ?? c.get?.("slots");
    if (!s) return "no slots svc";
    const proto = Object.getOwnPropertyNames(Object.getPrototypeOf(s));
    const own = Object.getOwnPropertyNames(s);
    return JSON.stringify({ own, proto });
  })()`));
  console.log("entriesOf model:", await evalJs(`(() => {
    const c = window.__mirachCtx;
    const s = c.slots ?? c.get?.("slots");
    if (!s || typeof s.entriesOf !== "function") return "no entriesOf";
    try {
      const e = s.entriesOf("conversation.input.model");
      return JSON.stringify(e.map(x => ({ id: x.options?.id, name: x.options?.name, compType: typeof x.component, optKeys: Object.keys(x.options ?? {}) })));
    } catch (err) { return "ERR " + err.message; }
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
