// 优先级语义实测：注册探针条目（-1 与 100）到 sidebar 槽读取排序后的条目顺序
// （不渲染——探针组件只是占位；测完即释放 disposer，不影响页面）。
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (async () => {
    const ctx = window.__mirachCtx;
    if (!ctx) return JSON.stringify({ err: 'no ctx' });
    const slots = ctx.slots;
    const out = { steps: [] };
    // 1) 现有条目状态（官方 + mirach-sidebar）
    out.before = slots.entries('sidebar').map(e => ({ id: e.options?.id, priority: e.options?.priority ?? 0 }));
    // 2) 注册两个探针：priority 100 与 priority -100（不同 id 避免同优先级抛错）
    const disposers = [];
    try {
      disposers.push(slots.register({ name: 'sidebar', id: 'probe-high', priority: 100 }, () => null));
      out.steps.push('probe-high(100) registered');
    } catch (e) { out.steps.push('probe-high failed: ' + String(e).slice(0, 160)); }
    try {
      disposers.push(slots.register({ name: 'sidebar', id: 'probe-low', priority: -100 }, () => null));
      out.steps.push('probe-low(-100) registered');
    } catch (e) { out.steps.push('probe-low failed: ' + String(e).slice(0, 160)); }
    // 3) 读排序后全量条目（entries 是排序视图）
    out.after = slots.entries('sidebar').map(e => ({ id: e.options?.id, priority: e.options?.priority ?? 0 }));
    // 4) winner（renderer 的影子胜者视图）
    try {
      const winners = slots.entriesOfSlot('sidebar');
      out.winners = winners.map(e => ({ id: e.options?.id, priority: e.options?.priority ?? 0 }));
    } catch (e) { out.winnersErr = String(e).slice(0, 160); }
    // 5) 清理探针
    for (const d of disposers) { try { d(); } catch {} }
    out.afterCleanup = slots.entries('sidebar').map(e => ({ id: e.options?.id, priority: e.options?.priority ?? 0 }));
    return JSON.stringify(out, null, 1);
  })()
  `;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: EXPR, returnByValue: true, awaitPromise: true } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 400));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 20000);
