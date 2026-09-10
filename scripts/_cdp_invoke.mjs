// _cdp_invoke.mjs — 通过 CDP 触发一次 Tauri 命令并打印结果（文本，无 vision）。
// 需要应用以远程调试启动：npm run tauri:debug（--remote-debugging-port=9222）。
// 用法：node scripts/_cdp_invoke.mjs <command> ['{"json":"params"}']
const CDP_HTTP = "http://127.0.0.1:9222";
const command = process.argv[2];
const params = process.argv[3] ? JSON.parse(process.argv[3]) : null;
if (!command) {
  console.error("usage: node scripts/_cdp_invoke.mjs <command> [paramsJson]");
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${CDP_HTTP}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error("no CDP page target (应用是否用 tauri:debug 启动？)");
}

const wsUrl = await getPageWs();
const ws = new WebSocket(wsUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
});
function sendCmd(method, cmdParams = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params: cmdParams }));
  });
}
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
await sendCmd("Runtime.enable");
const expression =
  `(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(params)}); ` +
  `return JSON.stringify({ ok: true, value: r }); } catch (e) { return JSON.stringify({ ok: false, error: String(e) }); } })()`;
const res = await sendCmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (res.exceptionDetails) {
  console.error("eval failed:", JSON.stringify(res.exceptionDetails));
  process.exit(1);
}
console.log(res.result?.value ?? "(no value)");
ws.close();
