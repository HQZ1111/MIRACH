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
  // 打开设置 + 切到通用设置，然后测 LanguageRow 的 t
  await evalJs(`(() => { if (document.querySelector('.settings-dropdown')) return 'open'; const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null); b?.click(); return 'clicked'; })()`);
  await new Promise((r) => setTimeout(r, 4000));
  await evalJs(`(() => { const d = document.querySelector('.settings-dropdown'); const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '通用设置'); b?.click(); return 'ok'; })()`);
  await new Promise((r) => setTimeout(r, 2500));
  console.log(await evalJs(`(() => {
    for (const el of document.querySelectorAll('*')) {
      const fk = Object.keys(el).find(k => k.startsWith('__reactFiber$'));
      if (!fk) continue;
      let f = el[fk];
      while (f) {
        const n = f.type?.name ?? '';
        if (n === 'LanguageRow' && f.memoizedProps?.t) {
          const t = f.memoizedProps.t;
          return JSON.stringify({ title: t('language.title'), fontSizeTitle: t('fontSize.title') });
        }
        f = f.return;
      }
    }
    return 'no LanguageRow';
  })()`));
  // 顺带全页健康检查
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    const fallback = [...(d?.querySelectorAll('p') ?? [])].filter(p => p.textContent.includes('官方项暂不可用')).length;
    return JSON.stringify({ overlay: !!d, fallbacks: fallback, rootKids: document.getElementById('root')?.childElementCount });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
