// 点击 mirach 左栏头部标题切到 sessions 视图，验证 tabs/置顶/官方列表
const WS = require("G:/deepseek-harness-master/node_modules/.pnpm/ws@8.21.0/node_modules/ws/index.js");

const ws = new WS("ws://127.0.0.1:9222/devtools/page/2AD0C38B52E56BC6AAC77B72062AF012");
ws.on("open", () => {
  const script = `
  (async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    // mirach 左栏头部标题按钮（文本 = cfg.label，如 'Mirach'/'Chat Mirach'）
    const aside = [...document.querySelectorAll('aside')].find(a => a.innerText.includes('团队列表'));
    if (!aside) return JSON.stringify({ err: 'no mirach aside' });
    const btn = [...aside.querySelectorAll('button')].find(b => b.innerText.trim() === 'Mirach' || b.className.includes('text-heading'));
    if (!btn) return JSON.stringify({ err: 'no header btn' });
    btn.click();
    await wait(1200);
    const out = {};
    out.afterClick = aside.innerText.replace(/\\n/g, '|').slice(0, 260);
    out.tabs = aside.innerText.includes('所有会话') && aside.innerText.includes('成员');
    out.pinned = aside.innerText.includes('已置顶会话');
    // 官方侧栏可见性
    const a = document.querySelector('.dsh-native-area');
    const frame = a && a.querySelector('div[style*="grid-template-columns"]');
    out.officialCols = frame ? getComputedStyle(frame).gridTemplateColumns : 'no frame';
    const officialCol = frame && frame.children[0];
    out.officialW = officialCol ? Math.round(officialCol.getBoundingClientRect().width) : -1;
    return JSON.stringify(out);
  })()
  `;
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: script, returnByValue: true, awaitPromise: true } }));
});
ws.on("message", (raw) => {
  const m = JSON.parse(raw);
  if (m.id === 1) {
    console.log(m.result?.result?.value ?? String(m.result?.exceptionDetails?.exception?.description ?? "").slice(0, 300));
    process.exit(0);
  }
});
setTimeout(() => process.exit(2), 30000);
