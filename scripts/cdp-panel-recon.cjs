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
  // 找到官方触发按钮（settings.trigger 槽内的按钮）并点击
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const triggerHost = mirror.querySelector('[data-slot="settings.trigger"]');
    const b = triggerHost?.querySelector('button');
    if (!b) return 'no trigger button';
    const r = b.getBoundingClientRect();
    b.click();
    return JSON.stringify({ clicked: true, cls: (b.className ?? '').toString().slice(0, 60), rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } });
  })()`));
  await new Promise((r) => setTimeout(r, 2500));
  // 面板结构：settings.section 槽 + 面板容器类名 + 位置
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const sectionHost = mirror.querySelector('[data-slot="settings.section"]');
    const nav = sectionHost ? [...sectionHost.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 20) : [];
    // 找面板容器（含 nav 的最近祖先链）
    let el = sectionHost; const chain = [];
    while (el && chain.length < 8) { const r = el.getBoundingClientRect(); chain.push({ tag: el.tagName, cls: (el.className ?? '').toString().slice(0, 50), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }); el = el.parentElement; }
    return JSON.stringify({ nav, chain, text: mirror.innerText.slice(0, 300) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
