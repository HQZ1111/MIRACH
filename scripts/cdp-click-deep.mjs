// add a capture-phase click listener at document (capture:true) to log target path + defaultPrevented; count real React onClick invocation by instrumenting via props of the button before click
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 400) };
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
    window.__clickLog = [];
    document.addEventListener('click', (e) => {
      const t = e.target;
      const btn = t.closest ? t.closest('button') : null;
      window.__clickLog.push({
        cls: (btn?.className ?? '').toString().slice(0, 40),
        text: (btn?.textContent ?? '').trim().slice(0, 12),
        composed: e.composedPath().length,
        defaultPrevented: e.defaultPrevented,
      });
    }, true);
    // find the model button's fiber onClick and wrap to log
    const mir = document.querySelector('[data-kernel-mirror]');
    const b = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')].find(c => (c.textContent ?? '').trim() === '模型');
    const k = Object.keys(b).find(x => x.startsWith('__reactProps$'));
    if (k) {
      const orig = b[k].onClick;
      b[k].onClick = function (...args) { window.__clickLog.push('REACT ONCLICK FIRED for 模型'); return orig.apply(this, args); };
    }
    return 'armed';
  })()`);
  const p = await evalJs(`(() => { const mir = document.querySelector('[data-kernel-mirror]'); const b = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')].find(c => (c.textContent ?? '').trim() === '模型'); const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
  const pp = JSON.parse(p);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pp.x, y: pp.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pp.x, y: pp.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pp.x, y: pp.y, button: "left", clickCount: 1 });
  await sleep(2500);
  console.log("log:", await evalJs(`JSON.stringify(window.__clickLog)`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
