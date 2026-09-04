// focused: (1) nav svg computed visibility/geometry in official settings panel
// (2) around the mirach big team avatar (HM circle) — any overlapping icon (puzzle/plugin style) + its class/d
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  const res = await rawEval(`(() => {
    const out = {};
    const mir = document.querySelector('[data-kernel-mirror]');
    // 1) nav cell svg metrics for first three nav cells
    const cells = [...(mir?.querySelectorAll('button') || [])].filter(b => {
      const r = b.getBoundingClientRect();
      return r.width > 80 && r.height > 24 && r.y > 90 && r.y < 700 && r.x > 300 && r.x < 900;
    }).slice(0, 6);
    out.navCells = cells.map(b => {
      const svg = b.querySelector('svg');
      let geom = null;
      if (svg) {
        const r = svg.getBoundingClientRect();
        const cs = getComputedStyle(svg);
        geom = { w: Math.round(r.width), h: Math.round(r.height), disp: cs.display, vis: cs.visibility, color: cs.color, cls: svg.getAttribute('class') };
      }
      return { txt: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,16), geom, btnRect: (() => { const r = b.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() };
    });
    // 2) the mirach big team avatar (HM circle ~80px)
    const circles = [...document.querySelectorAll('div')].filter(d => {
      const r = d.getBoundingClientRect();
      return r.width >= 70 && r.width <= 90 && r.height >= 70 && r.height <= 90 && (d.textContent||'').trim().length <= 4 && /[A-Z]{2}/.test(d.textContent||'');
    });
    out.bigCircles = circles.slice(0, 3).map(d => {
      const r = d.getBoundingClientRect();
      // walk up 5 ancestors; collect sibling svg icons whose rect intersects the circle rect expanded
      const R = { x: r.x, y: r.y, w: r.width, h: r.height };
      let node = d;
      const icons = [];
      for (let i = 0; i < 6 && node; i++) {
        const parent = node.parentElement;
        if (!parent) break;
        for (const ch of parent.children) {
          if (ch === node) continue;
          const svg = ch.querySelector ? ch.querySelector('svg') : null;
          if (!svg) continue;
          const sr = svg.getBoundingClientRect();
          const near = sr.width > 0 && Math.abs(sr.x - R.x) < 60 && Math.abs(sr.y - R.y) < 60;
          if (near) icons.push({ cls: svg.getAttribute('class'), w: Math.round(sr.width), h: Math.round(sr.height), x: Math.round(sr.x), y: Math.round(sr.y), d: (svg.querySelector('path')?.getAttribute('d')||'').slice(0, 60), parentCls: (ch.className||'').toString().slice(0,60) });
        }
        node = parent;
      }
      return { txt: d.textContent.trim(), rect: [Math.round(R.x), Math.round(R.y), Math.round(R.w), Math.round(R.h)], icons };
    });
    return JSON.stringify(out).slice(0, 4000);
  })()`);
  console.log(res);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
