const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
const ex = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 200) };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); return; }
  if (m.method === "Runtime.exceptionThrown") {
    ex.push((m.params.exceptionDetails.exception?.description ?? "").slice(0, 150));
  }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // 记录发送前正文长度
  const before = await evalJs(`document.body.innerText.length`);
  // 聚焦输入框、输入、回车
  await evalJs(`(() => {
    const ta = document.querySelector('textarea[placeholder*="输入消息"]');
    if (!ta) return 'no textarea';
    ta.focus();
    return 'focused';
  })()`);
  await send("Input.insertText", { text: "升级验证：请只回复两个字：正常" });
  await new Promise((r) => setTimeout(r, 500));
  await evalJs(`(() => {
    const ta = document.querySelector('textarea[placeholder*="输入消息"]');
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return 'enter';
  })()`);
  // 等回复（最多 60s，每 5s 采样一次正文长度与最新内容）
  let reply = null;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const now = await evalJs(`document.body.innerText.length`);
    if (typeof now === "number" && typeof before === "number" && now > (before ?? 0) + 40) {
      const tail = await evalJs(`document.body.innerText.slice(-400)`);
      reply = tail;
      break;
    }
  }
  console.log("== E2E 回复采样 ==");
  console.log(typeof reply === "string" ? JSON.stringify(reply.slice(-300)) : "no reply detected in 60s");
  console.log("== exceptions ==");
  console.log(JSON.stringify(ex.slice(0, 3)));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 120000);
