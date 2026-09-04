// detect big panel presence and dump all panels + navcells rects
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? r;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    if (!mir) return 'no mirror';
    const panels = [...mir.querySelectorAll('[class*="_panel"]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; });
    const navs = [...mir.querySelectorAll('[class*="_navCell"]')].length;
    const big = panels.filter(p => p[2] > 300 && p[3] > 300);
    return JSON.stringify({ panels, navs, big });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
