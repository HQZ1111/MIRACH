// _messaging_check.mjs — 打开左栏"通讯"覆盖层并读回面板真实内容
const PORT = Number(process.argv[2] || 9222);
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && !(t.url || "").includes("win=") && !(t.url || "").includes("index.html"));
const target = page ?? list.find((t) => t.type === "page");
if (!target) {
  console.error("no target: " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
console.log("target: " + target.url);
const ws = new WebSocket(target.webSocketDebuggerUrl);
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

const expr = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = document.querySelector('button[title="通讯"]')
    ?? [...document.querySelectorAll('button[title]')].find((b) => /通讯|消息平台/.test(b.title));
  if (!btn) return JSON.stringify({ clicked: false, titles: [...document.querySelectorAll('button[title]')].map((b) => b.title).filter(Boolean).slice(0, 30) });
  btn.click();
  await wait(1500);
  const shell = [...document.querySelectorAll('div')].find((d) => (d.textContent || '').includes('IM 桥'));
  return JSON.stringify({
    clicked: true,
    panelHead: shell ? shell.textContent.replace(/\\s+/g, ' ').slice(0, 320) : null,
    hasFakePlatform: /Discord|Mattermost|Matrix|Slack/.test(document.body.innerText),
    rows: [...document.querySelectorAll('p')].map((p) => p.textContent.trim()).filter((t) => /dsh-im|IM 桥|微信|飞书|Telegram|企业微信/.test(t)).slice(0, 12),
  }, null, 1);
})()`;
const res = await sendCmd("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
console.log(res.exceptionDetails ? "EXC " + JSON.stringify(res.exceptionDetails).slice(0, 400) : res.result?.value);
ws.close();
