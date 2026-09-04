// click cell index 12 (模型 official) and check active state
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
    const navList = mir.querySelector('[class*="_navList"]');
    const b = [...navList.querySelectorAll('button')][12];
    if (!b) return 'no cell12';
    const r = b.getBoundingClientRect();
    for (const [T, opts] of [["pointerdown", { bubbles: true, button: 0 }], ["mousedown", { bubbles: true, button: 0 }], ["mouseup", { bubbles: true }], ["click", { bubbles: true }]]) {
      b.dispatchEvent(new (T === "pointerdown" ? PointerEvent : MouseEvent)(T, { ...opts, clientX: r.x + 5, clientY: r.y + 5 }));
    }
    return 'clicked ' + (b.textContent ?? '').trim();
  })()`));
  await sleep(3000);
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const cells = [...navList.querySelectorAll('button')];
    const act = cells.map((b,i) => ({ i, t:(b.textContent??'').trim(), a:((b.className??'').toString().includes('active')) })).filter(x => x.a);
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    return JSON.stringify({ active: act, head: (secHost?.innerText ?? '').slice(0, 220) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
