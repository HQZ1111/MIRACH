// reload 时间线：抓崩溃与异常（root=0 诊断）
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
const logs = [];
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 3, method: "Page.reload", params: { ignoreCache: true } }));
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.method === "Runtime.exceptionThrown") {
      logs.push({
        type: "EXCEPTION",
        text: String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 400),
      });
    }
    if (m.method === "Runtime.consoleAPICalled" && (m.params.type === "error" || m.params.type === "warning")) {
      const text = (m.params.args || []).map((a) => {
        if (a.value !== undefined) return typeof a.value === "string" ? a.value.slice(0, 250) : JSON.stringify(a.value).slice(0, 250);
        if (a.description) return a.description.slice(0, 250);
        return a.type;
      }).join(" ");
      logs.push({ type: m.params.type, text });
    }
  });
  setTimeout(() => {
    console.log(logs.slice(0, 20).map((l) => `[${l.type}] ${l.text}`).join("\n=====\n") || "clean");
    process.exit(0);
  }, 20000);
});
setTimeout(() => process.exit(2), 40000);
