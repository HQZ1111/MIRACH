// 验证官方侧栏内容（搜索框 + 工作区 + 会话列表）在对话区内可见
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    const a = document.querySelector('.dsh-native-area');
    const frame = a && a.querySelector('div[style*="grid-template-columns"]');
    if (!frame) return JSON.stringify({ err: 'no frame' });
    const cols = [...frame.children];
    const sidebarCol = cols[0];
    const r = sidebarCol.getBoundingClientRect();
    out.sidebar = { x: Math.round(r.x), w: Math.round(r.width), visible: r.width > 0 };
    const input = sidebarCol.querySelector('input');
    out.searchInput = input ? { placeholder: input.placeholder || '(无placeholder)', w: Math.round(input.getBoundingClientRect().width) } : 'none';
    out.head = sidebarCol.innerText.replace(/\\n/g, '|').slice(0, 180);
    // session 行数（官方 WorkspaceBrowser 的列表行）
    const rows = sidebarCol.querySelectorAll('[class*="row"], [role="button"]');
    out.rowCount = rows.length;
    return JSON.stringify(out);
  })()
  `;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 300));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 15000);
