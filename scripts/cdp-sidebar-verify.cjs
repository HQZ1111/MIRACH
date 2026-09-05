// 检查左侧栏当前渲染状态：官方 workspace-host 是否存在、ready 状态、tabs 是否还在
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    out.host = !!document.querySelector('.mirach-workspace-host');
    const host = document.querySelector('.mirach-workspace-host');
    if (host) out.hostHead = host.innerText.replace(/\\n/g, '|').slice(0, 150);
    // ctx 槽位检查：sidebar.workspaces 有没有条目
    const ctx = window.__mirachCtx;
    if (ctx && ctx.slots) {
      const slots = ctx.slots;
      const tryList = (k) => {
        try { return (slots.entries ? slots.entries(k) : slots.entriesOf ? slots.entriesOf(k) : []).length; }
        catch { return 'err'; }
      };
      out.slotWorkspaces = tryList('sidebar.workspaces');
      out.slotRoot = tryList('root');
    }
    // 内核 boot 状态
    out.kernelBooted = !!ctx;
    // 左侧栏文本（mirach 280px 列）
    const left = [...document.querySelectorAll('div')].find(d => Math.abs(d.getBoundingClientRect().width - 280) < 3 && d.getBoundingClientRect().x < 10 && d.getBoundingClientRect().height > 400);
    out.leftHead = left ? left.innerText.replace(/\\n/g, '|').slice(0, 200) : 'absent';
    // 标签按钮
    out.tabsPresent = document.body.innerText.includes('所有会话') && document.body.innerText.includes('成员');
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
