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
  const before = await evalJs(`document.body.innerText.length`);
  await evalJs(`(() => {
    const ta = document.querySelector('textarea[placeholder*="输入消息"]');
    if (!ta) return 'no textarea';
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '只列工具名：你当前可用的工具里，哪些与子代理（subagent）相关？特别说明是否有 send_message 与 interrupt_agent。不要解释。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'typed';
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(`(() => { const ta = document.querySelector('textarea[placeholder*="输入消息"]'); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return 'enter'; })()`);
  let reply = null;
  for (let i = 0; i < 18; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const st = await evalJs(`(() => {
      const ta = document.querySelector('textarea[placeholder*="输入消息"]');
      // 找最后一条 assistant 消息（含 send_message 字样的块）
      const blocks = [...document.querySelectorAll('div,section')].filter(e => /send_message/.test(e.textContent ?? '') && e.children.length < 30);
      return JSON.stringify({ taEmpty: ta?.value === '', hit: blocks.length > 0, last: (blocks.at(-1)?.textContent ?? '').slice(0, 300) });
    })()`);
    const parsed = JSON.parse(st);
    if (parsed.taEmpty && parsed.hit) { reply = parsed.last; break; }
  }
  console.log("== 工具清单回答采样 ==");
  console.log(reply ? JSON.stringify(reply) : "60s 内未捕获（可能仍在生成）");
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 150000);
