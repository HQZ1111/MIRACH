// 优先级语义最终验证：在活页面里注册一个 priority:100 和 priority:-1 的探针条目
// 到一个测试 single 槽，看 winner 是谁（用 mirach 段落里现成的 slots 服务）
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    const ctx = window.__mirachCtx;
    if (!ctx) return JSON.stringify({ err: 'no ctx' });
    // 读 sidebar 槽当前条目（官方 SidebarRoot 的 priority）
    const entries = ctx.slots.entries('sidebar');
    out.sidebarEntries = entries.map(e => ({ id: e.options?.id, priority: e.options?.priority ?? 0 }));
    // 读 core 的 winner
    const winners = ctx.slots.entriesOfSlot ? ctx.slots.entriesOfSlot('sidebar') : [];
    out.winnerId = winners[0]?.options?.id ?? 'unknown';
    return JSON.stringify(out);
  })()
  `;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 250));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 15000);
