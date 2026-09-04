// Investigate whether 模型 click handler receives the event: add capture listener counting
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
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
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const b = [...navList.querySelectorAll('button')].find(c => (c.textContent ?? '').trim() === '模型');
    window.__clicks = [];
    b.addEventListener('click', (e) => { window.__clicks.push('bubble'); e.stopPropagation(); }, true);
    b.addEventListener('click', (e) => { window.__clicks.push('bubble-real'); }, false);
    return 'armed';
  })()`);
  const pt = await send("Runtime.evaluate", {
    expression: `(() => {
      const mir = document.querySelector('[data-kernel-mirror]');
      const b = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')].find(c => (c.textContent ?? '').trim() === '模型');
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`,
    returnByValue: true,
  });
  const p = pt.result?.result?.value;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(1500);
  console.log("clicks:", await evalJs(`JSON.stringify(window.__clicks)`));
  console.log("active:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const cells = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')];
    return JSON.stringify(cells.map((b,i)=>({i,t:(b.textContent??'').trim(),a:((b.className??'').toString().includes('active'))})).filter(x=>x.a));
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
