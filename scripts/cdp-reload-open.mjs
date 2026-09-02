const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
const ex = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    const desc = m.params.exceptionDetails.exception?.description ?? "";
    if (desc.includes("Maximum")) ex.push(desc);
  }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 18000));
  await send("Runtime.evaluate", {
    expression: `(() => { if (document.querySelector('.settings-dropdown')) return 'open'; const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null); b?.click(); return 'clicked'; })()`,
    returnByValue: true,
  });
  await new Promise((r) => setTimeout(r, 5000));
  console.log("crashes:", ex.length);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
