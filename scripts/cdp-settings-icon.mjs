// snapshot: capture full settings-panel & sidebar-team DOM (both mirach shell and official mirror) for offline analysis
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
  // Open official settings (click settings.trigger)
  const openRes = await rawEval(`(() => {
    const btn = document.querySelector('[data-kernel-mirror] [data-slot="settings.trigger"]')?.closest('button');
    if (!btn) return 'no trigger';
    btn.click();
    return 'clicked';
  })()`);
  console.log("open:", openRes);
  await sleep(2500);
  console.log("snap:", await rawEval(`(() => {
    const out = {};
    const mir = document.querySelector('[data-kernel-mirror]');
    if (mir) {
      // nav rows inside official panel
      const cells = [...mir.querySelectorAll('button[aria-current], [class*="_navCell"]')].map(b => ({
        txt: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40),
        aria: b.getAttribute('aria-current'),
        hasSvg: !!b.querySelector('svg'),
        html: b.innerHTML.slice(0,180)
      }));
      out.panelCells = cells.slice(0, 12);
      // any svg path/icon in nav
      const navSvg = mir.querySelector('[class*="_navList"] svg, [class*="_navCell"] svg');
      out.navSvgSample = navSvg ? navSvg.outerHTML.slice(0,200) : null;
      // official header + workspace brand near big avatar?
      out.workspaceTexts = [...mir.querySelectorAll('[data-slot]')].map(e => e.getAttribute('data-slot') + ':' + (e.textContent||'').replace(/\\s+/g,' ').trim().slice(0,40)).slice(0,24);
    }
    // mirach shell team list big avatar overlays (right-top badges etc)
    const big = [...document.querySelectorAll('div[style*="80px"], div[style*="width: 80"], div[style*="height: 80"]')].slice(0,4).map(d => ({ cls: d.className, style: d.getAttribute('style'), kids: d.children.length, html: d.innerHTML.slice(0,260) }));
    out.bigAvatars = big;
    return JSON.stringify(out).slice(0, 5000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
