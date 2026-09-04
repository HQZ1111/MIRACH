// SettingsRoot render contains the panel dialog AND trigger row. Two SettingsRoots may exist:
// one under hidden kernel root child, one in visible sidebar.settings surface. But nav cells we read are the visible panel. Click switches nothing => maybe the visible panel is rendered by a root whose onSelect callback is stale? OR the click lands on visible but re-render swaps to the OTHER root's snapshot.
// Count SettingsRoot component instances via fiber scan under [data-kernel-mirror]
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    // walk the whole tree fibers under mirror root node
    const rootEl = mir.querySelector('[data-slot="root"] > div');
    const roots = [rootEl];
    const found = [];
    const seen = new Set();
    const scan = (node) => {
      for (const k of Object.keys(node)) {
        if (!k.startsWith('__reactFiber$')) continue;
        let f = node[k];
        const guard = 0;
        let depth = 0;
        while (f && depth < 60) {
          const t = f.type;
          const nm = typeof t === 'function' ? (t.displayName || t.name) : '';
          if (nm && !seen.has(nm)) { seen.add(nm); }
          f = f.child || f.sibling || f.return?.sibling;  // incorrect walker — instead do BFS via returns only is tricky
          depth++;
        }
      }
    };
    // Simpler: count .triggerRow + aria-expanded triggers inside whole mirror
    const triggers = [...mir.querySelectorAll('button[aria-expanded]')].map(b => ({ txt: (b.textContent ?? '').trim().slice(0, 12), exp: b.getAttribute('aria-expanded') }));
    const panels = [...mir.querySelectorAll('[class*="_panel"]')].map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
    return JSON.stringify({ triggers, panels });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
