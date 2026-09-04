// walk declaration chain: root -> ... find which conversation-related slots are live
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
    const keys = ["root","sidebar","sidebar.settings","conversation","details","shell.overlay","conversation.composer.bar","conversation.composer.dock","conversation.input.model"];
    const out = keys.map(k => {
      try {
        const e = s.entriesOfSlot(k);
        const arr = Array.isArray(e) ? e : [];
        return { k, n: arr.length, names: arr.map(x => x.name ?? x.options?.id).slice(0, 3) };
      } catch (err) { return { k, err: err.message.slice(0, 60) }; }
    });
    // try to read the root entry children declaration
    let rootEntry = null;
    try {
      const e = s.entriesOfSlot("root") ?? [];
      const first = Array.isArray(e) ? e[0] : null;
      rootEntry = first ? { name: first.name, childKeys: Object.keys(first.children ?? {}), childDecl: Object.fromEntries(Object.entries(first.children ?? {}).map(([k,v]) => [k, v?.kind])) } : null;
    } catch (err) { rootEntry = "ERR " + err.message; }
    return JSON.stringify({ out, rootEntry });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
