// 模型 section shows official provider rows: DeepSeek / ds / 自定义 — the '自定义' row IS mirach's provider config source (ds = custom provider from mirach config 'ds'? Actually 'ds' appears as provider). Click 编辑 on DeepSeek to see key input, and click 添加自定义提供方 maybe shows modal. Dump editor panel that opens.
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
    const editBtns = [...opt.querySelectorAll('button')].map((b, i) => ({ i, t: (b.textContent ?? '').trim() })).filter(x => /编辑|删除|添加/.test(x.t));
    return JSON.stringify(editBtns);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
