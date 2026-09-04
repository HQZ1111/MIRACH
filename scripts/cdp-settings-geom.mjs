// probe settings panel geometry + overflow (surfaced state)
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
  // open settings the same way the gear does (dispatch the event the app listens to)
  console.log("open:", await evalJs(`(() => {
    const fired = window.dispatchEvent(new Event("mirach:open-settings"));
    return "dispatch=" + fired;
  })()`));
  await sleep(4000);
  console.log("geometry:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    if (!mir) return "no mirror";
    const surfaced = mir.classList.contains("dsh-settings-surface");
    const panel = mir.querySelector('[data-slot="sidebar.settings"] > div');
    const root = mir.querySelector('[data-slot="root"] > div');
    const rect = (el) => { const r = el?.getBoundingClientRect(); return r ? [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : null; };
    const win = { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio };
    const panelStyle = panel ? (() => { const cs = getComputedStyle(panel); return { pos: cs.position, inset: cs.inset, width: cs.width, height: cs.height, visibility: cs.visibility, overflow: cs.overflow }; })() : null;
    const panelKids = panel ? [...panel.children].map((el) => ({ tag: el.tagName, slot: el.getAttribute("data-slot"), rect: rect(el), cls: (el.className ?? "").toString().slice(0, 50) })) : [];
    // scroll metrics of panel and its scrollable subtrees
    const scrolls = [];
    if (panel) {
      for (const el of [panel, ...panel.querySelectorAll("div")]) {
        if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 50) {
          scrolls.push({ tag: el.tagName, cls: (el.className ?? "").toString().slice(0, 60), slot: el.getAttribute("data-slot"), clientH: el.clientHeight, scrollH: el.scrollHeight, clientW: el.clientWidth, scrollW: el.scrollWidth });
          if (scrolls.length > 8) break;
        }
      }
    }
    return JSON.stringify({ win, surfaced, rootRect: rect(root), panelRect: rect(panel), panelStyle, panelKids, scrolls });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
