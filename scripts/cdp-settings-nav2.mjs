// click 模型 within the VISIBLE panel nav list only, then dump options
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
  let open = await evalJs(`(() => { const mir = document.querySelector('[data-kernel-mirror]'); return mir?.classList.contains('dsh-settings-surface') || false; })()`);
  if (!open) { await evalJs(`window.dispatchEvent(new Event("mirach:open-settings"))`); await sleep(3500); }
  console.log("nav-in-panel:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const panel = [...mir.querySelectorAll('[class*="_panel"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 500 && r.height > 400; })[0];
    if (!panel) return 'no panel';
    const navList = panel.querySelector('[class*="_navList"]');
    if (!navList) return 'no navlist; panel text head ' + panel.innerText.slice(0, 60);
    const btns = [...navList.querySelectorAll('button')].map(b => ({ t: (b.textContent ?? '').trim(), vis: b.offsetParent !== null }));
    const modelBtn = [...navList.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '模型');
    if (modelBtn) { modelBtn.click(); return 'clicked; candidates=' + JSON.stringify(btns); }
    return 'no model btn; candidates=' + JSON.stringify(btns.slice(0, 20));
  })()`));
  await sleep(3500);
  console.log("content:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const panel = [...mir.querySelectorAll('[class*="_panel"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 500 && r.height > 400; })[0];
    const opt = panel?.querySelector('[class*="_options"]');
    return (opt?.innerText ?? '(none)').slice(0, 2000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
