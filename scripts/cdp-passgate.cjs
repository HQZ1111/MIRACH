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
  console.log(await evalJs(`(() => {
    const tas = [...document.querySelectorAll('input[type="password"]')];
    if (tas.length === 0) return 'no password inputs';
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(tas[0], 'mirach');
    if (tas[1]) set(tas[1], 'mirach');
    return 'filled ' + tas.length;
  })()`));
  await new Promise((r) => setTimeout(r, 400));
  console.log(await evalJs(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存' || b.textContent.trim() === '完成');
    btn?.click();
    return btn ? 'clicked ' + btn.textContent.trim() : 'no button';
  })()`));
  await new Promise((r) => setTimeout(r, 3000));
  console.log(await evalJs(`(() => JSON.stringify({ pwLeft: document.querySelectorAll('input[type="password"]').length, bodyHead: document.body.innerText.slice(0, 80) }))()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 40000);
