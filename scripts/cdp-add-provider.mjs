// click the 添加自定义提供方 in model options; dump resulting editor
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? JSON.stringify(r).slice(0, 200);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const opt = mir.querySelector('[class*="_options"]');
    const b = [...opt.querySelectorAll('button')].find(x => (x.textContent ?? '').trim() === '添加自定义提供方');
    if (!b) return 'no btn';
    b.click();
    return 'clicked';
  })()`));
  await sleep(2000);
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const opt = mir.querySelector('[class*="_options"]');
    const inputs = [...opt.querySelectorAll('input, textarea, select')].map(i => ({ tag: i.tagName, type: i.type, ph: i.placeholder, val: (i.value ?? '').slice(0, 40) }));
    return JSON.stringify({ text: (opt?.innerText ?? '').slice(-900), inputs: inputs.slice(0, 12) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
