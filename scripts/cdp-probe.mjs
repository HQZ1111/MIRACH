const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 300) };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Page.reload", { ignoreCache: true });
  await new Promise((r) => setTimeout(r, 25000));
  await evalJs(`(() => { if (document.querySelector('.settings-dropdown')) return 'open'; const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null); b?.click(); return 'clicked'; })()`);
  await new Promise((r) => setTimeout(r, 5000));
  console.log("== ctx probe ==");
  console.log(await evalJs(`(() => {
    const c = window.__mirachCtx;
    if (!c) return 'no ctx probe';
    const propLocale = c.locale ?? null;
    let gotLocale = null;
    try { gotLocale = c.get('locale') ?? null; } catch (e) { gotLocale = 'GET ERR ' + e.message; }
    const summarize = (l) => l ? { hasBind: typeof l.bind === 'function', dictKeys: l.dicts ? [...l.dicts.keys()] : (l.getSnapshot ? 'has getSnapshot' : 'none') } : null;
    return JSON.stringify({
      propLocale: summarize(propLocale),
      gotLocale: summarize(gotLocale),
    });
  })()`));
  console.log("== t test ==");
  console.log(await evalJs(`(() => {
    for (const el of document.querySelectorAll('*')) {
      const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fk) continue;
      let f = el[fk];
      while (f) {
        const n = f.type?.name ?? '';
        if (n === 'LanguageRow' && f.memoizedProps?.t) {
          const t = f.memoizedProps.t;
          return JSON.stringify({ title: t('language.title') });
        }
        f = f.return;
      }
    }
    return 'no LanguageRow';
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
