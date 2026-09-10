// _messaging_check2.mjs — 在所有 page target 里找有"通讯"按钮的那个，点开并读回面板内容
const PORT = Number(process.argv[2] || 9222);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");
console.log("targets: " + list.map((t) => t.url).join(" | "));

const evalIn = async (t, expression) => {
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
  const send = (method, params = {}) =>
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
    await send("Runtime.enable");
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? "EXC " + JSON.stringify(r.exceptionDetails).slice(0, 300) : r.result?.value;
  } finally {
    ws.close();
  }
};

const PROBE = `JSON.stringify({
  hasComms: !!document.querySelector('button[title="通讯"]'),
  title: document.title,
  text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 120),
})`;

let chosen = null;
for (const t of list) {
  const out = await evalIn(t, PROBE);
  console.log(`- ${t.url} => ${out}`);
  if (typeof out === "string" && out.includes('"hasComms":true')) chosen = t;
}
if (!chosen) {
  console.log("没有找到带通讯按钮的窗口");
  process.exit(1);
}
const CLICK = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('button[title="通讯"]').click();
  await wait(1800);
  const head = [...document.querySelectorAll('div')].map((d) => d.textContent || '').find((t) => t.includes('IM 桥'));
  const rows = [...document.querySelectorAll('p')].map((p) => p.textContent.trim()).filter((t) => /dsh-im|IM 桥|微信|飞书|Telegram|企业微信/.test(t)).slice(0, 14);
  return JSON.stringify({
    head: head ? head.replace(/\\s+/g, ' ').slice(0, 300) : null,
    rows,
    stillFake: /Discord|Mattermost|Matrix|Slack|Signal/.test(document.body.innerText),
  }, null, 1);
})()`;
console.log(await evalIn(chosen, CLICK));
