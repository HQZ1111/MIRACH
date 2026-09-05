// 输入条右侧工具行 DOM 探针：各按钮顺序/间距/文字显示状态
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const EXPR = `
  (() => {
    const out = {};
    const card = document.querySelector('[data-composer-card]');
    if (!card) return JSON.stringify({ err: 'no composer card' });
    // 工具行 = 卡片内第一行（含 + 号按钮）
    const row = card.querySelector('button[aria-haspopup="listbox"]')?.parentElement;
    if (!row) return JSON.stringify({ err: 'no toolbar row' });
    const items = [...row.querySelectorAll(':scope > *')].map(el => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        tag: el.tagName,
        cls: String(el.className).slice(0, 40),
        text: el.innerText.replace(/\\n/g, '/').slice(0, 24),
        w: Math.round(r.width),
        x: Math.round(r.x),
        gap: cs.gap,
        display: cs.display,
      };
    });
    out.items = items;
    out.rowWidth = Math.round(row.getBoundingClientRect().width);
    out.areaWidth = Math.round((document.querySelector('.dsh-native-area') || document.body).getBoundingClientRect().width);
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
