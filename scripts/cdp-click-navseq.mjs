// row ids exist incl models. Test: click cells and dump aria-currents + which navCell gets active. Focus: does clicking change trigger aria-expanded/open? Also dump all buttons aria-current=page.
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
  const pos = async (selText) => (await send("Runtime.evaluate", {
    expression: `(() => { const mir = document.querySelector('[data-kernel-mirror]'); const b = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')].find(c => (c.textContent ?? '').trim() === ${JSON.stringify(selText)}); if(!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
    returnByValue: true,
  })).result?.result?.value;
  const state = () => evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const cur = [...mir.querySelectorAll('[aria-current]')].map(e => ({ t: (e.textContent ?? '').trim().slice(0,12), aria: e.getAttribute('aria-current') }));
    const trig = mir.querySelector('[data-slot="settings.trigger"]')?.closest('button');
    return JSON.stringify({ cur, expanded: trig?.getAttribute('aria-expanded'), trigTxt: (trig?.textContent ?? '').trim() });
  })()`);
  console.log("before", await state());
  const p12 = await pos("模型");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p12.x, y: p12.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p12.x, y: p12.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p12.x, y: p12.y, button: "left", clickCount: 1 });
  await sleep(2500);
  console.log("after model click", await state());
  // now click plugins
  const p2 = await pos("插件");
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p2.x, y: p2.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p2.x, y: p2.y, button: "left", clickCount: 1 });
  await sleep(2500);
  console.log("after plugins click", await state());
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
