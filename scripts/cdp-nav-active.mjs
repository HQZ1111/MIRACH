// settings nav: TWO blocks of mirach + official in ONE navList — wait, only one 模型 appears and earlier clicks landed on 通用设置 (first). The official sections come AFTER 子代理后端 (mirach). '模型' is the ONLY one. Why didn't clicking it change options? Because settings.section list slot may render section host per activeId — the active section is 通用设置 default. Click 模型 again and dump the settings.section slot host + active state.
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
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    const activeCell = mir.querySelector('[class*="_navCell"][class*="_active"]');
    // section render host children
    const children = secHost ? [...secHost.children].map(c => ({ tag: c.tagName, cls: (c.className ?? '').toString().slice(0, 40), text: (c.innerText ?? '').slice(0, 40) })) : [];
    return JSON.stringify({
      activeNavText: activeCell ? (activeCell.textContent ?? '').trim() : null,
      sectionChildren: children.slice(0, 6),
      sectionTextHead: (secHost?.innerText ?? '').slice(0, 160),
    });
  })()`));
  // click 模型 nav
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const navList = mir.querySelector('[class*="_navList"]');
    const b = [...navList.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === '模型');
    b?.click(); return b ? 'clicked' : 'none';
  })()`));
  await sleep(3000);
  console.log("after:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const active = mir.querySelector('[class*="_navCell"][class*="_active"]');
    const secHost = mir.querySelector('[data-slot="settings.section"]');
    return JSON.stringify({ active: active ? (active.textContent ?? '').trim() : null, head: (secHost?.innerText ?? '').slice(0, 300) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
