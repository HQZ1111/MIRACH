// _hud_edge_toggle.mjs — 验证：没有标题栏、控件簇在"条子的另一端"、切方向后 bar/band 对调
const PORT = Number(process.argv[2] || 9222);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
const target = list.find((t) => (t.url || "").includes("win=hud"));
if (!target) {
  console.error("no hud target: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  const q = pending.get(m.id);
  if (!q) return;
  pending.delete(m.id);
  if (m.error) q.reject(new Error(JSON.stringify(m.error)));
  else q.resolve(m.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
await send("Runtime.enable");

const snapshot = `(() => {
  const r = (e) => { if (!e) return null; const x = e.getBoundingClientRect(); return [Math.round(x.x), Math.round(x.y), Math.round(x.width), Math.round(x.height)]; };
  const shell = document.querySelector('[data-hud-shell]');
  const bar = document.querySelector('[data-hud-slot~="composer-root"]');
  const card = document.querySelector('[class*="_pa_card"]');
  const band = document.querySelector('[data-hud-slot~="composer-bounds"]');
  const controls = document.querySelector('[data-hud-controls]');
  return {
    edge: shell ? shell.getAttribute('data-hud-edge') : null,
    hasTitlebar: !!document.querySelector('[data-hud-topbar]'),
    bar: r(bar), card: r(card), band: r(band), controls: r(controls),
    barOffset: shell ? shell.style.getPropertyValue('--hud-bar-offset') : null,
    bandHeight: shell ? shell.style.getPropertyValue('--hud-band-height') : null,
    controlsButtons: controls ? [...controls.querySelectorAll('button')].map((b) => b.title) : [],
    viewport: [window.innerWidth, window.innerHeight],
  };
})()`;

const read = async () => {
  const res = await send("Runtime.evaluate", { expression: snapshot, returnByValue: true });
  return res.result?.value;
};

console.log("=== edge=top (默认) ===");
console.log(JSON.stringify(await read(), null, 1));

// 点方向切换（第一个按钮），等它重排
await send("Runtime.evaluate", {
  expression: `document.querySelector('[data-hud-controls] button')?.click(); true`,
  returnByValue: true,
});
await new Promise((r) => setTimeout(r, 900));
console.log("=== 切换后 ===");
console.log(JSON.stringify(await read(), null, 1));

// 切回去，别把用户的选择留在调试态
await send("Runtime.evaluate", {
  expression: `document.querySelector('[data-hud-controls] button')?.click(); true`,
  returnByValue: true,
});
await new Promise((r) => setTimeout(r, 600));
console.log("=== 切回 ===");
console.log(JSON.stringify(await read(), null, 1));
ws.close();
