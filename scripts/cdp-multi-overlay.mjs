// count visible panels + overlay roots; find all [class*=_overlay] fixed containing mask+panel
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
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
  console.log(await rawEval(`(() => {
    const overlays = [...document.querySelectorAll('body *')].filter(e => {
      const cs = getComputedStyle(e);
      return cs.position === 'fixed' && (cs.zIndex === '1000') && e.querySelector('[class*="_panel"]');
    });
    const panels = [...document.querySelectorAll('[class*="_panel"]')].map(e => {
      const r = e.getBoundingClientRect();
      return { r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], vis: getComputedStyle(e).visibility };
    });
    return JSON.stringify({ overlayCount: overlays.length, overlays: overlays.map(o => o.className.slice(0, 40)), panels });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
