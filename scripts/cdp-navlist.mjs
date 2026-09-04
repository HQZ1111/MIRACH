// settings: two navLayers exist (mirach + official). The official 模型 is AFTER 手机访问. The click went to first '模型' which is in the SECOND (official) list region? candidates show TWO 通用设置/模型. Need panel-internal active section render key: settings.section host. Dump which option pane is live after clicking OFFICIAL 模型 (index in full button list: use visible panel buttons filtered to navList).
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
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const panel = [...mir.querySelectorAll('[class*="_panel"]')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 500 && r.height > 400; })[0];
    const navLists = panel ? [...panel.querySelectorAll('[class*="_navList"]')] : [];
    return JSON.stringify({ navListCount: navLists.length, perList: navLists.map(nl => [...nl.querySelectorAll('button')].map(b => (b.textContent ?? '').trim())) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
