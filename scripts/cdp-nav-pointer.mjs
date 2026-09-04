// dispatch real pointer+click on the 模型 nav cell and watch for change / errors
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") logs.push((m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 400));
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const b = [...navList.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '模型');
    if (!b) return 'no button';
    const r = b.getBoundingClientRect();
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: r.x + 5, clientY: r.y + 5 }));
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: r.x + 5, clientY: r.y + 5 }));
    b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    return JSON.stringify({ rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
  })()`));
  await sleep(3500);
  console.log("active after:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const active = mir.querySelector('[class*="_navCell"][class*="_active"]');
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    return JSON.stringify({ active: active ? (active.textContent ?? '').trim() : null, head: (secHost?.innerText ?? '').slice(0, 200) });
  })()`));
  console.log("exceptions:", logs.slice(0, 5));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
