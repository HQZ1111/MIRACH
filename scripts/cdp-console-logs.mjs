// capture runtime console errors from the live page
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
const logs = [];
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
  if (m.method === "Runtime.consoleAPICalled") {
    const type = m.params.type;
    const args = (m.params.args ?? []).map(a => a.value ?? a.description ?? "").join(" ").slice(0, 300);
    logs.push(type + ": " + args);
  }
  if (m.method === "Runtime.exceptionThrown") {
    const ex = m.params.exceptionDetails;
    logs.push("EXCEPTION: " + (ex.exception?.description ?? ex.text).slice(0, 500));
  }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Log.enable");
  await new Promise((r) => setTimeout(r, 3000));
  // trigger reload to capture boot errors
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 15000));
  console.log("=== captured " + logs.length + " entries ===");
  for (const l of logs.slice(0, 40)) console.log(l);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
