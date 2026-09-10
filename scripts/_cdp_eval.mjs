// _cdp_eval.mjs — 通用 CDP 驱动（读 DOM / 点按钮 / 执行任意 JS）
//
// 连接方式（二选一）：
//   a) npm run tauri:debug  → 端口 9222
//   b) 任意 WebView2 应用带 WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
//
// 用法：
//   node scripts/_cdp_eval.mjs text   [port]                # 打印页面可见文本（前 4000 字）
//   node scripts/_cdp_eval.mjs click  "<文本>" [port]        # 按文本点按钮/可点元素
//   node scripts/_cdp_eval.mjs eval   "<js>"   [port]        # 任意表达式（支持 await）
const [, , mode, arg, portArg] = process.argv;
const PORT = Number(portArg || process.env.MIRACH_CDP_PORT || 9222);
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 30; i++) {
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
  throw new Error(`no CDP page target on :${PORT}`);
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

const SNIPPETS = {
  text: `document.body.innerText.slice(0, 4000)`,
  html: `document.body.innerHTML.length + ' bytes html'`,
  click: `(() => {
    const want = ${JSON.stringify(arg ?? "")};
    const nodes = [...document.querySelectorAll('button,a,[role="button"],input,div')];
    const hit = nodes.find((el) => (el.innerText || el.value || el.getAttribute('placeholder') || '').trim().includes(want));
    if (!hit) return 'NOT FOUND: ' + want;
    hit.click();
    return 'clicked: ' + (hit.innerText || hit.value || '').slice(0, 60);
  })()`,
};

const expression = mode === "eval" ? `(async () => { ${arg} })()` : SNIPPETS[mode] ?? SNIPPETS.text;
const res = await sendCmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (res.exceptionDetails) {
  console.error("eval failed:", JSON.stringify(res.exceptionDetails).slice(0, 800));
  process.exit(1);
}
console.log(typeof res.result?.value === "string" ? res.result.value : JSON.stringify(res.result?.value));
ws.close();
