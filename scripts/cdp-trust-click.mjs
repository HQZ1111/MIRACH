// trusted Input domain mouse click on 模型 nav cell (page coords measured ~502,702)
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // get exact center of cell with text 模型 inside navList
  const pt = await send("Runtime.evaluate", {
    expression: `(() => {
      const mir = document.querySelector('[data-kernel-mirror]');
      const navList = mir.querySelector('[class*="_navList"]');
      const cells = [...navList.querySelectorAll('button')];
      const b = cells.find(c => (c.textContent ?? '').trim() === '模型');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`,
    returnByValue: true,
  });
  const p = pt.result?.result?.value;
  console.log("target", JSON.stringify(p));
  if (!p) process.exit(0);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(3000);
  const st = await send("Runtime.evaluate", {
    expression: `(() => {
      const mir = document.querySelector('[data-kernel-mirror]');
      const navList = mir.querySelector('[class*="_navList"]');
      const cells = [...navList.querySelectorAll('button')];
      const active = cells.map((b,i) => ({ i, t: (b.textContent ?? '').trim(), a: (b.className ?? '').toString().includes('active') })).filter(x => x.a);
      const secHost = mir.querySelector('[data-slot="settings.section"]');
      return JSON.stringify({ active, head: (secHost?.innerText ?? '').slice(0, 120) });
    })()`,
    returnByValue: true,
  });
  console.log("after", st.result?.result?.value);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
