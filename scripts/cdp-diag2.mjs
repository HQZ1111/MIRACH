// diag2: reproduce nativeLocaleTranslate exactly + check mirror official conversation DOM
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
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(async () => {
    const out = {};
    try {
      const boot = await import('/src/dsh-kernel/boot.ts');
      const t = boot.nativeLocaleTranslate('model');
      out.tFromBoot = typeof t;
      const ns = ['model','plan','permission','command'];
      out.nsFns = {};
      for (const n of ns) { try { out.nsFns[n] = typeof boot.nativeLocaleTranslate(n); } catch(e){ out.nsFns[n] = 'ERR'; } }
    } catch (e) { out.bootImportErr = String(e).slice(0, 300); }
    // mirror internal official conversation presence
    const mir = document.querySelector('[data-kernel-mirror]');
    if (mir) {
      const card = mir.querySelector('[data-composer-card]');
      const seat = mir.querySelector('.native-model-seat');
      const mSel = mir.querySelector('[class*="conversation"], [data-slot]');
      out.mirrorCard = !!card;
      out.mirrorNativeSeat = !!seat;
      // official model seat trigger text inside mirror if any
      const trig = mir.querySelector('button[aria-label*="模型"], button[aria-haspopup="menu"]');
      out.mirrorModelTrigger = trig ? { text: trig.textContent.slice(0,80), aria: trig.getAttribute('aria-label') } : null;
      out.mirrorSlotKeys = [...mir.querySelectorAll('[data-slot]')].slice(0,10).map(e => e.getAttribute('data-slot'));
      // any session message rows / conversation content
      const msgArea = mir.querySelector('[data-message-stream], [class*="message"], [class*="conversation"]');
      out.mirrorMsg = msgArea ? msgArea.innerText.slice(0,150) : null;
    } else out.mirrorErr = 'no mirror';
    return JSON.stringify(out).slice(0, 4000);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
