// close settings via clicking the settings.trigger (aria-expanded false path) OR dispatch our app close event
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? 'ERR';
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // click close button inside panel (its aria label likely 关闭)
  const clicked = await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const closeBtn = [...mir.querySelectorAll('button')].find(b => {
      const a = b.getAttribute('aria-label') || (b.textContent || '').trim();
      return a === '关闭' || a === 'Close' || (b.className || '').toString().includes('_close');
    });
    if (closeBtn) { closeBtn.click(); return 'clicked close'; }
    return 'no close btn';
  })()`);
  console.log(clicked);
  await sleep(1500);
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const trig = mir.querySelector('[data-slot="settings.trigger"]')?.closest('button');
    return JSON.stringify({ expanded: trig?.getAttribute('aria-expanded'), surfaced: mir?.classList.contains('dsh-settings-surface') });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
