const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // 过密码门（若有）
  const gate = await evalJs(`(() => {
    const tas = [...document.querySelectorAll('input[type="password"]')];
    if (tas.length === 0) return 'no gate';
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(tas[0], 'mirach'); if (tas[1]) set(tas[1], 'mirach');
    return 'filled';
  })()`);
  if (gate === 'filled') {
    await new Promise((r) => setTimeout(r, 400));
    await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存' || b.textContent.trim() === '完成'); b?.click(); return 1; })()`);
    await new Promise((r) => setTimeout(r, 2500));
  }
  // 跳过 onboarding（若有）
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => /直接进入主页/.test(b.textContent.trim())); b?.click(); return 1; })()`);
  await new Promise((r) => setTimeout(r, 2000));
  // 发问
  await evalJs(`(() => {
    const ta = document.querySelector('textarea[placeholder*="输入消息"]');
    if (!ta) return 'no textarea';
    ta.focus();
    const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    s.call(ta, '只列工具名：你当前与子代理（subagent）相关的工具有哪些？特别确认是否有 send_message 与 interrupt_agent。不要解释。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(`(() => { const ta = document.querySelector('textarea[placeholder*="输入消息"]'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return 'enter'; })()`);
  // 轮询回答（最多 120s）
  let answer = null;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await evalJs(`(() => {
      const ta = document.querySelector('textarea[placeholder*="输入消息"]');
      const blocks = [...document.querySelectorAll('div,section')].filter(e => /send_message/.test(e.textContent ?? '') && (e.textContent ?? '').length < 800);
      return JSON.stringify({ taEmpty: ta?.value === '', n: blocks.length, last: (blocks.at(-1)?.textContent ?? '').slice(0, 500) });
    })()`);
    const p = JSON.parse(st);
    if (p.taEmpty && p.n > 0) { answer = p.last; break; }
  }
  console.log("== agent 回答采样 ==");
  console.log(answer ? JSON.stringify(answer) : "未在时限内捕获");
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 180000);
