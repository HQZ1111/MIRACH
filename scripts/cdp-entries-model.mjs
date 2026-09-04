// probe entriesOfSlot(conversation.input.model) live, WITHOUT reload (HMR applied module already)
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
  console.log(await evalJs(`(() => {
    const c = window.__mirachCtx;
    const s = c?.slots ?? c?.get?.("slots");
    if (!s) return "no slots";
    for (const fn of ["entriesOfSlot", "entries"]) {
      try {
        const e = s[fn]("conversation.input.model");
        const arr = Array.isArray(e) ? e : [];
        console.log("fn=" + fn + " count=" + arr.length);
        const flat = arr.map(x => ({ name: x.name, id: x.options?.id, comp: typeof x.component, ins: x.inject ? "fn" : "none" }));
        return JSON.stringify(flat);
      } catch (err) { console.log("fn=" + fn + " err=" + err.message); }
    }
    return "none";
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
