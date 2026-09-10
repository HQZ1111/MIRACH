// _targets_check.mjs — 列出所有 page target 并各自跑一段 JS（默认查顶栏插件图标条）
const PORT = Number(process.argv[2] || 9222);
const CUSTOM = process.argv[3];

const DEFAULT_EXPR = `(() => {
  const btns = [...document.querySelectorAll('button[title]')].filter((b) => /打开插件面板/.test(b.title));
  const glyphs = btns.map((b) => {
    const span = b.querySelector('span');
    const cs = span ? getComputedStyle(span) : null;
    return ((span?.textContent || '').trim()) + ' | ' + (cs?.color || '') + ' | ' + b.title.split(' —')[0];
  });
  return JSON.stringify({
    hudShell: !!document.querySelector('[data-hud-shell]'),
    h2: [...document.querySelectorAll('h2')].map((h) => h.textContent).slice(0, 2),
    pluginButtons: btns.length,
    glyphs,
    rootKids: document.getElementById('root')?.children.length ?? -1,
  });
})()`;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === "page");
for (const p of pages) {
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    const q = pending.get(m.id);
    if (!q) return;
    pending.delete(m.id);
    if (m.error) q.reject(new Error(JSON.stringify(m.error)));
    else q.resolve(m.result);
  });
  const sendCmd = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    const res = await sendCmd("Runtime.evaluate", {
      expression: CUSTOM ? `(async () => { ${CUSTOM} })()` : DEFAULT_EXPR,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(`=== ${p.url} (id=${p.id.slice(0, 8)}) ===`);
    console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 300) : res.result?.value);
  } catch (e) {
    console.log(`=== ${p.url} === ERR ${e.message}`);
  }
  ws.close();
}
