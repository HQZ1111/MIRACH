// settings model section now renders. Dump the FULL text of model options + any textarea/select input. This confirms 自定义模型 availability in official section.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: r.exceptionDetails.text };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const opt = mir.querySelector('[class*="_options"]');
    const inputs = [...opt.querySelectorAll('input, textarea, select')].map(i => ({ tag: i.tagName, type: i.type, val: (i.value ?? '').slice(0, 60), ph: i.placeholder }));
    return JSON.stringify({ text: (opt?.innerText ?? '').slice(0, 1200), inputs });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
