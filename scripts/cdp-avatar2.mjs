const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300);
  const v = r.result?.result?.value;
  return typeof v === "string" ? v : JSON.stringify(v);
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  const expr = `(() => {
    const cs = [...document.querySelectorAll('div')].filter(d => {
      const r = d.getBoundingClientRect();
      return r.width >= 70 && r.width <= 90 && r.height >= 70 && r.height <= 90 && /^[A-Z]{2}$/.test((d.textContent||'').trim());
    });
    const out = [];
    for (const c of cs.slice(0,2)) {
      const r = c.getBoundingClientRect();
      // walk up and collect nearby svg + innerHTML of the circle's parent chain up to 3 levels
      const chain = [];
      let node = c;
      for (let l = 0; l < 3 && node; l++) {
        const parent = node.parentElement;
        if (!parent) break;
        const kids = [...parent.children].filter(k => k !== node).map(k => {
          const svg = k.querySelector ? k.querySelector('svg') : null;
          const kr = k.getBoundingClientRect();
          return {
            tag: k.tagName,
            cls: (k.className||'').toString().slice(0,50),
            text: (k.textContent||'').replace(/\\s+/g,' ').trim().slice(0,20),
            x: Math.round(kr.x), y: Math.round(kr.y),
            hasSvg: !!svg,
            svgCls: svg ? (svg.getAttribute('class')||'').slice(0,40) : null,
            pathD: svg ? (svg.querySelector('path')?.getAttribute('d')||'').slice(0,50) : null,
          };
        }).filter(k => k.hasSvg || k.text);
        chain.push({ level: l, parentTag: parent.tagName, parentCls: (parent.className||'').toString().slice(0,50), siblings: kids });
        node = parent;
      }
      out.push({ text: c.textContent.trim(), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width)], chain });
    }
    return JSON.stringify(out).slice(0, 5000);
  })()`;
  console.log(await rawEval(expr));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
