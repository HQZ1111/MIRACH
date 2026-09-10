// _hud_shape_check.mjs — HUD 形状验收：官方侧栏列是否被压掉、composer 条是否落在窗口底部
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

const expr = `(() => {
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const cs = (el, p) => el ? getComputedStyle(el)[p] : null;
  const frame = document.querySelector('[data-hud-frame]');
  const shell = document.querySelector('[data-hud-shell]');
  const sidebar = document.querySelector('[data-hud-hide-col]');
  const slotSidebar = document.querySelector('[data-slot="sidebar"]');
  const dock = document.querySelector('[data-slot="composer-dock"]');
  const band = document.querySelector('[data-slot="composer-bounds"]');
  const topbar = document.querySelector('[data-hud-topbar]');
  return JSON.stringify({
    viewport: [window.innerWidth, window.innerHeight],
    readyState: document.readyState,
    rootKids: document.getElementById('root')?.children.length ?? -1,
    hasShell: !!shell,
    bodyText: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
    edge: shell?.getAttribute('data-hud-edge'),
    frameTagged: !!frame,
    frameCols: frame ? frame.style.gridTemplateColumns : null,
    frameComputedCols: frame ? cs(frame, 'gridTemplateColumns') : null,
    sideCellsTagged: document.querySelectorAll('[data-hud-hide-col]').length,
    sidebarSlotPresent: !!slotSidebar,
    sidebarSlotRect: rect(slotSidebar),
    sidebarSlotDisplay: cs(slotSidebar, 'display'),
    sidebarCellDisplay: sidebar ? cs(sidebar, 'display') : null,
    dockRect: rect(dock),
    dockBottomFromWindowBottom: dock ? Math.round(window.innerHeight - dock.getBoundingClientRect().bottom) : null,
    bandRect: rect(band),
    bandOpacity: cs(band, 'opacity'),
    topbarOpacity: topbar ? cs(topbar, 'opacity') : null,
    barHeightVar: shell ? getComputedStyle(shell).getPropertyValue('--hud-bar-height') : null,
  }, null, 1);
})()`;
const res = await send("Runtime.evaluate", { expression: expr, returnByValue: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 400) : res.result?.value);
ws.close();
