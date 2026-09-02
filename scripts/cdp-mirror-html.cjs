const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  const r = await send("Runtime.evaluate", { expression: `document.querySelector('[data-kernel-mirror]').innerHTML`, returnByValue: false });
  // 用 Runtime.getProperties 拿 outerHTML 字符串太绕——直接返回前 6000 字符
  const r2 = await send("Runtime.evaluate", { expression: `document.querySelector('[data-kernel-mirror]').innerHTML.slice(0, 6000)`, returnByValue: true });
  console.log(typeof r2.result?.result?.value === "string" ? r2.result.result.value : JSON.stringify(r2));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
