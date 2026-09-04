// trusted-click variant B: dispatch through elementFromPoint hit test
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  return send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  const arm = await rawEval(`(() => {
    window.__clickLog = [];
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button') : null;
      window.__clickLog.push('CLICK ' + ((b?.textContent ?? '').trim().slice(0, 10) || (b?.className ?? '').toString().slice(0, 20)));
    }, true);
    const mir = document.querySelector('[data-kernel-mirror]');
    const bs = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')];
    const b = bs.find(c => (c.textContent ?? '').trim() === '模型');
    const r = b.getBoundingClientRect();
    window.__pt = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    window.__hit = (() => { const el = document.elementFromPoint(window.__pt.x, window.__pt.y); return el ? (el.tagName + '.' + (el.className ?? '').toString().slice(0, 30)) : null; })();
    return 'armed pt=' + JSON.stringify(window.__pt) + ' hit=' + window.__hit;
  })()`);
  console.log(arm.result?.result?.value ?? JSON.stringify(arm));
  const pt = (await rawEval(`window.__pt`)).result?.result?.value;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await sleep(3000);
  console.log("log:", (await rawEval(`JSON.stringify(window.__clickLog)`)).result?.result?.value);
  console.log("current:", (await rawEval(`(() => { const m = document.querySelector('[data-kernel-mirror]'); return JSON.stringify([...m.querySelectorAll('[aria-current]')].map(e => (e.textContent ?? '').trim())); })()`)).result?.result?.value);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
