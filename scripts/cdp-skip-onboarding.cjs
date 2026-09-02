const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const cands = [...document.querySelectorAll('button')].map((b, i) => ({ i, t: b.textContent.trim().slice(0, 30), title: b.getAttribute('title'), aria: b.getAttribute('aria-label') })).filter(x => (x.t + x.title + x.aria).length > 0);
    return JSON.stringify(cands.filter(x => /直接|跳过|主页|skip|稍后|关闭/.test(x.t + x.title + x.aria)));
  })()`));
  console.log(await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => /直接进入主页|跳过/.test(b.textContent.trim() + (b.getAttribute('title') ?? '') + (b.getAttribute('aria-label') ?? '')));
    b?.click();
    return b ? 'clicked: ' + (b.textContent.trim() || b.getAttribute('title') || b.getAttribute('aria-label')) : 'not found';
  })()`));
  await new Promise((r) => setTimeout(r, 3000));
  console.log(await evalJs(`(() => JSON.stringify({ onboarding: document.body.innerText.includes('连接推理提供商'), ta: !!document.querySelector('textarea[placeholder*="输入消息"]') }))()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
