// read SettingsRoot tail: what happens after openSection; maybe the active compare fails because rows from useSections are 'projection rows' keyed by entry id but click sets activeId='models' while rows[0] used when activeId not in rows due to ROWS NOT INCLUDING models? Verify rows count via content: 16 cells rendered = 16 rows. Test: click cell 0 again after clicking 12 — does ANY nav cell respond? Also check whether settings host re-renders active when clicking an OFFICIAL general cell (idx 10, id=general).
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
  // click cell index 10 (官方 通用设置 id=general): if active moves to idx10, mirach cells can't switch because mirach register was with label object not matching active compare? but official would switch
  const click = async (i) => {
    await rawEval(`(() => { const mir = document.querySelector('[data-kernel-mirror]'); const b = [...mir.querySelector('[class*="_navList"]').querySelectorAll('button')][${i}]; const r = b.getBoundingClientRect(); window.__pt = { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) }; })()`);
    const pt = (await rawEval('window.__pt')).result?.result?.value;
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await sleep(2500);
  };
  await click(10);
  console.log("after idx10 (官方 general):", (await rawEval(`(() => { const m = document.querySelector('[data-kernel-mirror]'); return JSON.stringify([...m.querySelectorAll('[aria-current]')].map(e => (e.textContent ?? '').trim())); })()`)).result?.result?.value);
  const secTxt = (await rawEval(`(() => { const m = document.querySelector('[data-kernel-mirror]'); const h = m.querySelector('[data-slot="settings.section"]'); return (h?.innerText ?? '').slice(0, 80); })()`)).result?.result?.value;
  console.log("section head:", secTxt);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
