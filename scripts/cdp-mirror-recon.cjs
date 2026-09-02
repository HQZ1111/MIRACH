const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 200) };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    if (!mirror) return 'no mirror';
    // 镜像里的按钮盘点（前 25 个有文本的）
    const btns = [...mirror.querySelectorAll('button')].map((b, i) => ({
      i,
      text: (b.textContent ?? '').trim().slice(0, 24),
      title: b.getAttribute('title'),
      aria: b.getAttribute('aria-label'),
      cls: (b.className ?? '').toString().slice(0, 40),
    })).filter(x => x.text || x.title || x.aria).slice(0, 30);
    return JSON.stringify(btns);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
