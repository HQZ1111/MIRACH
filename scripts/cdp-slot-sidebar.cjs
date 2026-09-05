// 验证 renderSlot('sidebar') 是否被允许 + 检查 root 树内 SidebarRoot 的渲染形态
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    const ctx = window.__mirachCtx;
    if (!ctx) return JSON.stringify({ err: 'no ctx' });
    try {
      const node = ctx.slots.renderSlot('sidebar', { collapsed: false, width: 280 });
      out.sidebarType = typeof node;
      out.sidebarNull = node === null;
    } catch (e) { out.sidebarErr = String(e).slice(0, 200); }
    return JSON.stringify(out);
  })()
  `;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 200));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 15000);
