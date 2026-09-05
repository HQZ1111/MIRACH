// 验证 MirachSidebar 渲染：官方 sidebar 列内容应为 mirach 外壳（品牌行 Mirach +
// 新建任务 + 官方 workspaces + foot settings）
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.reload", params: { ignoreCache: true } }));
  setTimeout(() => {
    const EXPR = `
    (() => {
      const out = {};
      const a = document.querySelector('.dsh-native-area');
      const frame = a && a.querySelector('div[style*="grid-template-columns"]');
      if (!frame) return JSON.stringify({ err: 'no frame', root: document.getElementById('root')?.childElementCount });
      const sidebarCol = frame.children[0];
      const r = sidebarCol.getBoundingClientRect();
      out.sidebar = { x: Math.round(r.x), w: Math.round(r.width) };
      out.head = sidebarCol.innerText.replace(/\\n/g, '|').slice(0, 220);
      out.hasNewTask = sidebarCol.innerText.includes('新建任务');
      out.hasPinned = sidebarCol.innerText.includes('已置顶会话');
      out.hasOfficialSearch = !!sidebarCol.querySelector('input');
      out.hasWorkspaces = sidebarCol.innerText.includes('工作区') || sidebarCol.innerText.includes('ZCodeProject');
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
