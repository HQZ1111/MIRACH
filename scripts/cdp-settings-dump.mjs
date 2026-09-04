// dump settings panel content after surface, in full text
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
  await evalJs(`window.dispatchEvent(new Event("mirach:open-settings"))`);
  await sleep(4000);
  console.log("panel:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const overlay = mir.querySelector('[data-slot="sidebar.settings"] > div');
    if (!overlay) return "no overlay";
    const panel = overlay.querySelector('[class*="_panel"]');
    const r = (el) => { const x = el?.getBoundingClientRect(); return x ? [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)] : null; };
    const navs = [...overlay.querySelectorAll('button')].map(b => (b.textContent ?? '').trim()).filter(Boolean).slice(0, 40);
    const opt = overlay.querySelector('[class*="_options"]');
    return JSON.stringify({
      panelRect: r(panel),
      navCount: navs.length,
      navs,
      optsText: (opt?.innerText ?? '').slice(0, 700),
      optScrollH: opt ? opt.scrollHeight : null,
      optClientH: opt ? opt.clientHeight : null,
    });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
