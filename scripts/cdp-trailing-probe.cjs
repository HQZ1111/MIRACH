// 深入：找右侧 trailing 组（模型/用量/朗读/唤醒/听写/发送按钮）的真实 DOM 与间距
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    const card = document.querySelector('[data-composer-card]');
    if (!card) return JSON.stringify({ err: 'no card' });
    // 找发送按钮（disabled 空态 / 或 _primary）
    const send = card.querySelector("button[class*='_primary']");
    if (!send) return JSON.stringify({ err: 'no send btn' });
    // 向上找包含它的工具行
    let row = send.parentElement;
    out.rowCls = String(row.className).slice(0, 60);
    // 行内子元素（从右往左就是发送/唤醒/朗读/听写/模型/用量）
    const items = [...row.querySelectorAll(':scope > *')].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const btn = el.matches('button') ? el : el.querySelector('button');
      return {
        cls: String(el.className).slice(0, 44),
        text: el.innerText.replace(/\\n/g, '/').slice(0, 26),
        w: Math.round(r.width),
        gap: cs.gap,
        margin: cs.marginRight + '/' + cs.marginLeft,
      };
    });
    out.items = items;
    out.rowW = Math.round(row.getBoundingClientRect().width);
    // 卡片内两行之间的间距（工具行与输入区）
    const rowParent = row.parentElement;
    out.parentGap = getComputedStyle(rowParent).gap;
    out.parentDisplay = getComputedStyle(rowParent).display;
    out.parentRowGap = getComputedStyle(rowParent).rowGap;
    // 模式菜单（工作区内修改 等）里的选项
    const modes = card.querySelector("[class*='modes']");
    out.modesW = modes ? Math.round(modes.getBoundingClientRect().width) : null;
    out.modesChildren = modes ? [...modes.querySelectorAll(':scope > *')].map(b => b.innerText.replace(/\\n/g, '/').slice(0, 18)) : [];
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
