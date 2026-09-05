// reload 后抓 vite 错误覆盖层的组件栈（HMR overlay 会渲染完整 component stack）
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
const errors = [];
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Runtime.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 3, method: "Page.reload", params: { ignoreCache: false } }));
  // reload 后等崩 + overlay 渲染
  setTimeout(() => {
    ws.send(JSON.stringify({
      id: 10,
      method: "Runtime.evaluate",
      params: {
        expression: `JSON.stringify({
          overlay: (() => { const o = document.querySelector('vite-error-overlay'); return o ? (o.shadowRoot ? o.shadowRoot.textContent.slice(0, 3000) : o.textContent.slice(0, 3000)) : 'none'; })(),
          rootChildren: document.getElementById('root')?.childElementCount ?? -1,
        })`,
        returnByValue: true,
      },
    }));
  }, 12000);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.method === "Runtime.exceptionThrown") {
    errors.push(String(m.params.exceptionDetails?.exception?.description ?? "").slice(0, 500));
  }
  if (m.id === 10) {
    console.log("STATE:", m.result?.result?.value ?? "n/a");
    console.log("=== ERRORS ===");
    console.log(errors.join("\n=====\n").slice(0, 3000) || "none");
    process.exit(0);
  }
});
setTimeout(() => { console.log("TIMEOUT"); process.exit(2); }, 30000);
