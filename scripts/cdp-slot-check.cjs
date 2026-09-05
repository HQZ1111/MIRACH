// 深挖：页面 reload 后 LeftSidebar 到底渲染了什么？conv tab 里 OfficialWorkspaceBrowser
// 挂载了吗？browser node 是否一直 null？—— 从 window.__mirachCtx 直接调
// renderSlot('sidebar.workspaces') 看返回什么
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  ws.send(JSON.stringify({ id: 1, method: "Page.enable", params: {} }));
  ws.send(JSON.stringify({ id: 2, method: "Page.reload", params: { ignoreCache: false } }));
  setTimeout(() => {
    const EXPR = `
    (() => {
      const out = {};
      const ctx = window.__mirachCtx;
      if (!ctx) return JSON.stringify({ err: 'no ctx' });
      try {
        const node = ctx.slots.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: () => {} });
        out.renderSlotType = typeof node;
        out.renderSlotIsNull = node === null;
        out.isElement = node && typeof node === 'object' && !!node.$$typeof;
      } catch (e) { out.renderSlotErr = String(e).slice(0, 200); }
      // LeftSidebar 组件是否存在 + conv tab
      out.tabs = document.body.innerText.includes('所有会话');
      out.host = !!document.querySelector('.mirach-workspace-host');
      // root 存活
      out.rootChildren = document.getElementById('root')?.childElementCount ?? -1;
      return JSON.stringify(out);
    })()
    `;
    ws.send(JSON.stringify({ id: 3, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
  }, 25000);
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 3) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 300));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 50000);
