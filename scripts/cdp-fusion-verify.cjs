// hard reload（绕过 HTTP 缓存）+ 等待 boot + 全面验证融合状态
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.reload", params: { ignoreCache: true } }));
  setTimeout(() => {
    const EXPR = `
    (() => {
      const out = {};
      out.host = !!document.querySelector('.mirach-workspace-host');
      const host = document.querySelector('.mirach-workspace-host');
      if (host) out.hostHead = host.innerText.replace(/\\n/g, '|').slice(0, 160);
      out.tabs = document.body.innerText.includes('所有会话') && document.body.innerText.includes('成员');
      out.pinned = document.body.innerText.includes('已置顶会话');
      const a = document.querySelector('.dsh-native-area');
      const frame = a && a.querySelector('div[style*="grid-template-columns"]');
      out.computedCols = frame ? getComputedStyle(frame).gridTemplateColumns : 'no frame';
      out.root = document.getElementById('root')?.childElementCount ?? -1;
      return JSON.stringify(out);
    })()
    `;
    ws.send(JSON.stringify({ id: 3, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
  }, 26000);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 3) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 300));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 50000);
