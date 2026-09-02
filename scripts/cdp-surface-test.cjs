const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
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
  await new Promise((r) => setTimeout(r, 1500));
  // 点击 mirach 的设置齿轮（左工具栏 title=设置）
  console.log(await evalJs(`(() => {
    const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null);
    b?.click();
    return b ? 'clicked gear' : 'no gear';
  })()`));
  await new Promise((r) => setTimeout(r, 3500));
  console.log("== 浮出状态 ==");
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const surfaced = mirror?.classList.contains('dsh-settings-surface') ?? false;
    const expanded = mirror?.querySelector('[data-slot="settings.trigger"]')?.closest('button')?.getAttribute('aria-expanded');
    const navText = mirror?.querySelector('[data-slot="settings.section"]')?.textContent?.slice(0, 400) ?? '';
    return JSON.stringify({ surfaced, expanded, nav: navText.slice(0, 380) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
