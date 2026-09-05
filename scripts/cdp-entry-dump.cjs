// 深查 sidebar 槽：条目结构（StoredEntry 形状）+ 实际 winner
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const ctx = window.__mirachCtx;
    if (!ctx) return JSON.stringify({ err: 'no ctx' });
    const entries = ctx.slots.entries('sidebar');
    // dump 第一条的完整结构
    const first = entries[0];
    const shape = {};
    for (const k of Object.keys(first)) shape[k] = typeof first[k];
    const out = {
      count: entries.length,
      shape,
      list: entries.map(e => ({
        id: e.options?.id,
        priority: e.options?.priority,
        component: typeof e.component,
      })),
    };
    return JSON.stringify(out, null, 1);
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
