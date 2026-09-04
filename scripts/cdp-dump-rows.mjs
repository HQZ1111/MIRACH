// dump-rows: show actual distinct SVG glyph inside each settings nav row (class, first path d) + which rows are official vs mirach
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
  console.log(await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    if (!mir) return 'no mirror';
    const rows = [...mir.querySelectorAll('[class*="_navCell"], button')]
      .filter(b => {
        const r = b.getBoundingClientRect();
        const inPanel = r.width > 100 && r.x > 100 && r.y > 80; // panel region heuristic
        return inPanel && /设置|智能体|记忆|归档|安全|Git|键盘|统计|关于|子代理|手机访问|通用|对话|外观|模型/.test(b.textContent||'');
      });
    const info = rows.slice(0,16).map(b => {
      const svg = b.querySelector('svg');
      const path = svg?.querySelector('path');
      return {
        txt: (b.textContent||'').replace(/\\s+/g,' ').trim().slice(0,24),
        cls: (b.className||'').toString().slice(0,40),
        svgCls: (svg?.getAttribute('class')||'').toString().slice(0,40),
        pathD: (path?.getAttribute('d')||'').slice(0,70),
        svgBox: svg ? svg.getAttribute('viewBox') : null,
      };
    });
    return JSON.stringify(info);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
