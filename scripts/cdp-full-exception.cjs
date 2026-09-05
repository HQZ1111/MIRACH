// 完整 dump 一次 Runtime.exceptionThrown 的 exceptionDetails（全部字段），
// React 19 dev 会在 exceptionDetails.detailedDescription / exception.description 里
// 附带 "Error component stack"。同时抓 console.error 调用的完整 args。
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
let dumped = false;
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 3, method: "Page.reload", params: { ignoreCache: false } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.method === "Runtime.exceptionThrown" && !dumped) {
    dumped = true;
    const d = m.params.exceptionDetails || {};
    console.log("TEXT:", d.text);
    console.log("LINE:", d.lineNumber, "COL:", d.columnNumber, "URL:", d.url);
    console.log("DESCRIPTION FULL:");
    console.log(String(d.exception?.description ?? "").slice(0, 4000));
    setTimeout(() => process.exit(0), 500);
  }
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
    const full = (m.params.args || []).map((a) => {
      if (a.value !== undefined) return "VALUE: " + String(a.value).slice(0, 2500);
      if (a.description) return "DESC: " + a.description.slice(0, 2500);
      return a.type;
    }).join("\n---ARG---\n");
    if (full.includes("hooks") || full.includes("Component Stack") || full.includes("component stack")) {
      console.log("=== CONSOLE ERROR FULL ===");
      console.log(full.slice(0, 8000));
      setTimeout(() => process.exit(0), 500);
    }
  }
});
setTimeout(() => { console.log("no exception captured"); process.exit(2); }, 30000);
