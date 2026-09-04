// dsh-probe2: after settle — is official ConversationRoot rendering real session content in dsh mode?
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const out = {};
    // startup gate visible?
    const gate = [...document.querySelectorAll('div')].find(d => (d.textContent||'').includes('设置你的密码') && d.getBoundingClientRect().height > 300);
    out.gateVisible = gate ? getComputedStyle(gate).opacity + '@' + Math.round(gate.getBoundingClientRect().y) : null;
    const startup = document.querySelector('[data-startup-gate]');
    out.gateAttr = !!startup;
    // find conversation slot OUTSIDE mirror (NativeChatArea renders inline)
    const convs = [...document.querySelectorAll('[data-slot="conversation"]')];
    out.convCount = convs.length;
    out.convs = convs.map(c => {
      const r = c.getBoundingClientRect();
      const inMirror = !!c.closest('[data-kernel-mirror]');
      return { inMirror, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: (c.textContent||'').replace(/\\s+/g,' ').slice(0, 260) };
    });
    // mirach StatsLine visible?
    out.stats = [...document.querySelectorAll('*')].filter(e => /第 \\d+ 轮/.test(e.textContent||'') && e.children.length === 0).length;
    return JSON.stringify(out).slice(0, 4000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
