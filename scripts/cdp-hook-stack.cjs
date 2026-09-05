// 抓 React 组件栈：拦截 console.error 输出里的 "Error component stack"（React DEV 会在
// console.error 的最后一个 arg 附带 componentStack 字符串）——用 Runtime.consoleAPICalled 拿完整 args
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
let errs = [];
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 3, method: "Page.reload", params: { ignoreCache: false } }));
  setTimeout(() => process.exit(0), 20000);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    const args = m.params.args || [];
    const main = String(args[0]?.value ?? args[0]?.description ?? "");
    if (main.includes("hooks") || main.includes("Rendered fewer")) {
      const compArg = args.find((a) => String(a.description ?? a.value ?? "").includes("component stack") || String(a.description ?? a.value ?? "").includes("at "));
      errs.push({ text: main.slice(0, 120), stack: String(compArg?.description ?? compArg?.value ?? "").slice(0, 2200) });
    }
  }
  if (m.method === "Runtime.exceptionThrown") {
    errs.push({ text: "EXCEPTION", stack: String(m.params.exceptionDetails?.exception?.description ?? "").slice(0, 2000) });
  }
});
process.on("exit", () => {
  for (const e of errs) {
    console.log("=== ", e.text);
    console.log(e.stack);
  }
  if (!errs.length) console.log("no hook errors captured");
});
