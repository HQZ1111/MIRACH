// After Esc close, settings are closed (expanded false everywhere). Re-open, click model, then verify switch in SAME session.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await rawEval(`window.dispatchEvent(new Event("mirach:open-settings"))`);
  await sleep(4000);
  // find settings trigger in the visible surface and click model cell using .click on the REAL nav cell inside visible panel (aria-current element? which panel is visible)
  console.log("pre:", await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const cells = [...mir.querySelectorAll('[class*="_navList"] button')];
    const vis = cells.filter(b => b.getBoundingClientRect().width > 0 && b.offsetParent !== null);
    const cur = cells.filter(b => (b.getAttribute('aria-current')) || (b.className||'').toString().includes('active')).map(b => (b.textContent??'').trim());
    const modelCell = vis.find(b => (b.textContent ?? '').trim() === '模型');
    const r = modelCell?.getBoundingClientRect();
    if (modelCell) { modelCell.click(); window.__ptM = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; }
    return JSON.stringify({ visCount: vis.length, current: cur, modelFound: !!modelCell });
  })()`));
  await sleep(2500);
  console.log("post:", await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const cells = [...mir.querySelectorAll('[class*="_navList"] button')];
    const cur = cells.filter(b => ((b.className||'').toString().includes('active') || b.getAttribute('aria-current'))).map(b => (b.textContent??'').trim());
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    return JSON.stringify({ current: cur, head: (secHost?.innerText ?? '').slice(0, 100) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
