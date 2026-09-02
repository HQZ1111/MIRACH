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
  // 切到 手机访问
  await evalJs(`(() => { const d = document.querySelector('.settings-dropdown'); const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '手机访问'); b?.click(); return b ? 'ok' : 'not found'; })()`);
  await new Promise((r) => setTimeout(r, 4000));
  console.log("== 手机访问 content ==");
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    const host = d?.querySelector('.tavern-native-host');
    return JSON.stringify({ active: '手机访问', body: host ? host.innerText.slice(0, 500) : '(no host)', fallbacks: [...(d?.querySelectorAll('p') ?? [])].filter(p => p.textContent.includes('官方项暂不可用')).length });
  })()`));
  // RPC 健康度：引擎侧 /dsh-pocket 通道
  console.log("== pocket RPC ==");
  console.log(await evalJs(`(async () => {
    const c = window.__mirachCtx;
    if (!c) return 'no ctx';
    try {
      const conn = c.get('connection');
      const r = await conn.rpc.call('/dsh-pocket', 'pocket.status', {}, undefined);
      return JSON.stringify(r).slice(0, 400);
    } catch (e) { return 'RPC ERR ' + (e.message ?? e); }
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
