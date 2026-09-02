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
  // 过门
  await evalJs(`(() => {
    const tas = [...document.querySelectorAll('input[type="password"]')];
    if (tas.length === 0) return 'no gate';
    const set = (el, v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
    set(tas[0], 'mirach'); if (tas[1]) set(tas[1], 'mirach');
    return 'filled';
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '保存' || b.textContent.trim() === '完成' || b.textContent.trim() === '解锁'); b?.click(); return 1; })()`);
  await new Promise((r) => setTimeout(r, 2500));
  await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => /直接进入主页/.test(b.textContent.trim())); b?.click(); return 1; })()`);
  await new Promise((r) => setTimeout(r, 1500));
  // 点 mirach 设置齿轮
  console.log(await evalJs(`(() => { const b = [...document.querySelectorAll('button')].find(b => b.getAttribute('title') === '设置' && b.offsetParent !== null); b?.click(); return b ? 'gear clicked' : 'no gear'; })()`));
  await new Promise((r) => setTimeout(r, 3500));
  // 官方面板状态 + 导航混排
  console.log("== 浮出 + 导航 ==");
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const surfaced = mirror?.classList.contains('dsh-settings-surface') ?? false;
    const expanded = mirror?.querySelector('[data-slot="settings.trigger"]')?.closest('button')?.getAttribute('aria-expanded');
    const panel = mirror?.querySelector('[data-slot="sidebar.settings"] > div');
    const navText = (panel?.textContent ?? '').slice(0, 500);
    return JSON.stringify({ surfaced, expanded, panelRect: (() => { const r = panel?.getBoundingClientRect(); return r ? [Math.round(r.width), Math.round(r.height)] : null })(), nav: navText });
  })()`));
  // 点击 mirach 的 记忆 分区（官方面板导航里）
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const b = [...mirror.querySelectorAll('button')].find(x => x.textContent.trim() === '记忆');
    b?.click();
    return b ? '记忆 clicked' : 'not found';
  })()`));
  await new Promise((r) => setTimeout(r, 2500));
  console.log("== 记忆分区内容 ==");
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    const panel = mirror?.querySelector('[data-slot="sidebar.settings"] > div');
    const text = (panel?.textContent ?? '').slice(0, 260);
    const ta = [...(panel?.querySelectorAll('textarea') ?? [])].length;
    return JSON.stringify({ text, textareas: ta });
  })()`));
  // 关闭（背板点击）：镜像容器本体
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    mirror.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return 'backdrop mousedown';
  })()`));
  await new Promise((r) => setTimeout(r, 1500));
  console.log("== 关闭后 ==");
  console.log(await evalJs(`(() => {
    const mirror = document.querySelector('[data-kernel-mirror]');
    return JSON.stringify({ surfaced: mirror?.classList.contains('dsh-settings-surface') ?? false, inert: mirror?.inert ?? null });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
