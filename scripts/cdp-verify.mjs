// cdp-verify — 设置页修复验证：单根 / 槽位订阅 / 分区切换 / 控制台错误
// 用法：node scripts/cdp-verify.mjs <ws-url>  （可选第二个参数 = 点击的分区名，默认 模型）
const WS = process.argv[2];
if (!WS) {
  console.error("usage: node cdp-verify.mjs <ws-url> [section-id]");
  process.exit(1);
}
const TARGET = process.argv[3] ?? "模型";

const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
const events = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 200) };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    events.push({ kind: "exception", text: `${m.params.exceptionDetails.text} ${m.params.exceptionDetails.exception?.description ?? ""}`.slice(0, 200) });
  } else if (m.method === "Runtime.consoleAPICalled") {
    const t = m.params.type;
    if (t === "error" || t === "warning") {
      const text = (m.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200);
      if (text.includes("dsh-kernel") || text.includes("official") || text.includes("slot") || text.includes("createRoot")) events.push({ kind: "console:" + t, text });
    }
  }
};
ws.onopen = async () => {
  await send("Runtime.enable");

  // 若 overlay 关闭则先打开
  console.log("== 打开设置 ==");
  console.log(await evalJs(`(() => {
    if (document.querySelector('.settings-dropdown')) return 'already open';
    const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null);
    b?.click();
    return b ? 'clicked trigger' : 'no trigger';
  })()`));
  await new Promise((r) => setTimeout(r, 2500));

  console.log("== 单根检查（overlay root === 容器 root）==");
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    if (!d) return 'overlay closed';
    const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '${TARGET}');
    if (!b) return 'no ${TARGET} button';
    let x = b[Object.keys(b).find(k => k.startsWith('__reactFiber$'))];
    while (x && x.tag !== 3) x = x.return;
    const rootEl = document.getElementById('root');
    const ck = Object.keys(rootEl).find(k => k.startsWith('__reactContainer$'));
    return JSON.stringify({ sameRoot: x === rootEl[ck] });
  })()`));

  console.log("== 分区列表 + active ==");
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    const nav = [...d.querySelectorAll('button')].map(b => b.textContent.trim()).filter(t => t && t.length < 20);
    const active = [...d.querySelectorAll('button')].filter(y => (y.className ?? '').match(/(^| )bg-muted( |$)/)).map(y => y.textContent.trim());
    return JSON.stringify({ nav: nav.slice(0, 25), active });
  })()`));

  console.log(`== 点击 ${TARGET} ==`);
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    const b = [...d.querySelectorAll('button')].find(x => x.textContent.trim() === '${TARGET}');
    b?.click();
    return b ? 'clicked' : 'not found';
  })()`));
  await new Promise((r) => setTimeout(r, 2000));
  console.log("== 切换后 ==");
  console.log(await evalJs(`(() => {
    const d = document.querySelector('.settings-dropdown');
    const active = [...d.querySelectorAll('button')].filter(y => (y.className ?? '').match(/(^| )bg-muted( |$)/)).map(y => y.textContent.trim());
    const head = (d ? d.innerText : '').slice(0, 300);
    return JSON.stringify({ active, head });
  })()`));

  console.log("== 关键 console 事件 ==");
  console.log(JSON.stringify(events.slice(-15), null, 1));
  process.exit(0);
};
ws.onerror = () => { console.error("WS error"); process.exit(2); };
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
