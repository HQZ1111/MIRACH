// read fiber chain from the VISIBLE dialog panel (its class may not be *_panel exact since css hash now live but still WYVdaG_panel). The earlier panels probe found no big .panel — because dump runs openSettings first. Run openSettings then fiber probe in one session.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { err: (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0,300) };
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await rawEval(`window.dispatchEvent(new Event("mirach:open-settings"))`);
  await sleep(3500);
  console.log("fiber:", await rawEval(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const btn = [...mir.querySelectorAll('button')].find(b => { const r = b.getBoundingClientRect(); return r.width > 120 && r.height > 30 && (b.textContent ?? '').trim() === '模型'; });
    if (!btn) return 'no 模型 btn';
    const k = Object.keys(btn).find(x => x.startsWith('__reactFiber$'));
    if (!k) return 'no fiber';
    let f = btn[k];
    const chain = [];
    while (f && chain.length < 14) {
      const t = f.type;
      const nm = typeof t === 'function' ? (t.displayName || t.name) : (typeof t === 'string' ? t : '');
      if (nm) {
        const s = f.memoizedState;
        let info = '';
        if (s && typeof s === 'object') {
          if ('memoizedState' in s) info = 'state=' + JSON.stringify(s.memoizedState).slice(0, 60);
          else if (Array.isArray(s)) info = 'hook0=' + JSON.stringify(s[0] && s[0].memoizedState).slice(0, 60);
        }
        chain.push(nm + (info ? '[' + info + ']' : ''));
      }
      f = f.return;
    }
    return JSON.stringify(chain);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
