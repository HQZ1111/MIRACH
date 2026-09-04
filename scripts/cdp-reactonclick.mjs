// investigate: all nav cells (incl official 模型) do NOT switch active. Maybe settings.section list slot renders ONLY winner per cell? Both mirach register at negative order and official at 0.. They all appear in navList so slot renders all list entries; clicking must set open section id. Active stays 通用设置 = mirach cell 0. Clicking 12 should switch to official section id 'model'? Maybe clicks land but model section content renders into a DIFFERENT host? Dump the activeId holder & every host slot subtree count after clicking 12.
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
  // capture click handler by directly invoking the React onClick prop
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const b = [...navList.querySelectorAll('button')][12];
    if (!b) return 'no b';
    // find React props with onClick
    const key = Object.keys(b).find(k => k.startsWith('__reactProps$'));
    const props = key ? b[key] : null;
    const onClick = props?.onClick;
    if (typeof onClick === 'function') {
      onClick({ currentTarget: b });
      return 'called react onClick directly';
    }
    return 'no react onClick; keys=' + Object.keys(b).filter(k=>k.startsWith('__react')).join(',');
  })()`));
  await sleep(3000);
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const cells = [...navList.querySelectorAll('button')];
    const act = cells.map((b,i)=>({i,t:(b.textContent??'').trim(),a:((b.className??'').toString().includes('active'))})).filter(x=>x.a);
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    return JSON.stringify({ active: act, head: (secHost?.innerText ?? '').slice(0, 150) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
