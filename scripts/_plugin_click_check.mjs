// _plugin_click_check.mjs — 点顶栏某个插件图标，验证"打开插件自己的面板"
// 用法：node scripts/_plugin_click_check.mjs [包名片段] [port]
const NEEDLE = process.argv[2] || "dsh-pocket";
const PORT = Number(process.argv[3] || 9222);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
let winner = null;
for (const t of list.filter((x) => x.type === "page")) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
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
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  await sendCmd("Runtime.enable");
  const probe = await sendCmd("Runtime.evaluate", {
    expression: `[...document.querySelectorAll('button[title]')].some((b) => b.title.includes(${JSON.stringify(NEEDLE)}))`,
    returnByValue: true,
  });
  if (probe.result?.value === true && !winner) {
    // 命中：留着这条连接用（关掉再发命令会 unsettled）
    winner = { t, sendCmd };
    continue;
  }
  ws.close();
}
if (!winner) {
  console.error("没找到带该插件图标的窗口");
  process.exit(1);
}
const { sendCmd } = winner;
const expr = `(async () => {
  const btn = [...document.querySelectorAll('button[title]')].find((b) => b.title.includes(${JSON.stringify(NEEDLE)}));
  btn.click();
  await new Promise((r) => setTimeout(r, 900));
  const search = [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').includes('搜索插件'));
  const focusedRow = [...document.querySelectorAll('div')].find((d) => (d.className || '').toString().includes('border-[#6366F1]/60'));
  const buttons = focusedRow ? [...focusedRow.querySelectorAll('button')].map((b) => b.textContent.trim() || b.title) : [];
  return JSON.stringify({
    overlayOpen: !!search,
    searchValue: search ? search.value : null,
    focusedRowText: focusedRow ? focusedRow.textContent.replace(/\\s+/g, ' ').slice(0, 120) : null,
    focusedRowButtons: buttons,
  }, null, 1);
})()`;
const res = await sendCmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 400) : res.result?.value);
