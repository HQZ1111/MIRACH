// avatar-context: dump full HTML subtree containing the HM 80px circle (the team view header) so we can see any overlapping/plugin-ish svg & outer card layers
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const circles = [...document.querySelectorAll('div')].filter(d => {
      const r = d.getBoundingClientRect();
      return r.width >= 70 && r.width <= 90 && r.height >= 70 && r.height <= 90 && /^[A-Z]{2}$/.test((d.textContent||'').trim());
    });
    const c = circles[0];
    if (!c) return 'no circle';
    // climb to the nearest ancestor that has '团队列表' or the team name text and dump its outerHTML trimmed
    let node = c;
    let target = null;
    for (let i = 0; i < 8 && node; i++) {
      const t = (node.textContent||'');
      if (t.includes('团队') && node.className && typeof node.className === 'string' && node.className.includes('aside')) { target = node; break; }
      node = node.parentElement;
    }
    const scope = target || c.closest('aside') || c.parentElement?.parentElement?.parentElement;
    if (!scope) return 'no scope';
    const html = scope.outerHTML;
    // strip style/class noise to make readable, keep structure + svg d snippets
    let cleaned;
    try {
      cleaned = html
        .replace(/<svg[^>]*>([\s\S]*?)<\/svg>/g, (m) => { const d = (m.match(/d="([^"]{0,50})"/)||[])[1]||''; return '<SVG d="'+d+'" >'; })
        .replace(/\s(class|style)="[^"]*"/g, '')
        .replace(/[\\t\\n\\r]+/g, '')
        .replace(/>\\s+</g, '><')
        .slice(0, 3000);
    } catch (e) { cleaned = 'clean err ' + e.message; }
    return typeof cleaned === 'string' ? cleaned : JSON.stringify(cleaned);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
