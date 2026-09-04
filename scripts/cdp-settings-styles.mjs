// measure official panel/mask/overlay/options computed styles
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
  await sleep(500);
  console.log("styles:", await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const sel = ['.WYVdaG_mask', '.WYVdaG_panel', '.WYVdaG_overlay', '.WYVdaG_options', '.WYVdaG_navCell'];
    const out = {};
    for (const s of sel) {
      const el = mir.querySelector(s);
      if (!el) { out[s] = null; continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out[s] = {
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        position: cs.position,
        inset: cs.inset,
        width: cs.width, height: cs.height,
        top: cs.top, left: cs.left, right: cs.right, bottom: cs.bottom,
        maxWidth: cs.maxWidth, maxHeight: cs.maxHeight,
        margin: cs.margin,
        overflow: cs.overflow,
        transform: cs.transform,
        display: cs.display,
      };
    }
    // which stylesheet rule defines .WYVdaG_panel? dump matched rules
    const ruleDump = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      if (!rules) continue;
      for (const rule of rules) {
        if (rule.selectorText && /WYVdaG_(panel|mask|overlay|options|navCell)/.test(rule.selectorText)) {
          ruleDump.push({ selector: rule.selectorText, css: rule.cssText.slice(0, 300) });
          if (ruleDump.length > 12) break;
        }
      }
      if (ruleDump.length > 12) break;
    }
    out.__rules = ruleDump.slice(0, 12);
    return JSON.stringify(out);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
