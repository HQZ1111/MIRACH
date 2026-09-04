// The settings nav lists BOTH mirach (ids chat-style..subagents) and official (通用设置=official general? no—the first 通用设置 is chat-style mirach labeled 通用设置). Wait: cell 10 is ALSO 通用设置 and 11 手机访问 12 模型 — those are official sections (settings-general, pocket/mobile, settings-models). Active stays on cell0 because the mirach entry (order -32 通用设置) is 'chat-style'. Clicking official 模型 should switch official panel to that section. Why no switch? Possibly because activeCell compare uses entry.id !== activeId and the 'active' cell prop derives from ctx-level store; clicking official sets settings section active inside OFFICIAL SettingsRoot component, which is a SEPARATE component from our mirach surface... but navList is ONE list mixing both.
// Actually the mix means the same SettingsRoot nav renders settings.section entries from BOTH providers and a shared open/activeId. So clicking should work. Unless clicks are swallowed by the disabled overlay behind? We surfaced via dispatch but the pointer events in the app may be intercepted by mirach top UI (the app is NOT inert-hidden in this state: we only dispatch open event; openOfficialSettings toggles mirror + surface). Let's check is surfaced class present.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 500) };
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    const overlay = mir.querySelector('[data-slot="sidebar.settings"] > div');
    const rootChild = mir.querySelector('[data-slot="root"] > div');
    const r = { surface: mir.className, rootChildVis: rootChild ? getComputedStyle(rootChild).visibility : null, overlayVis: overlay ? getComputedStyle(overlay).visibility : null, overlayHidden: overlay ? overlay.closest('[hidden]')?.tagName : null };
    // which mirach UI is in the foreground? The app root (outside mirror) still visible
    const appRoot = document.getElementById('root');
    r.appRootText = (appRoot?.innerText ?? '').slice(0, 80);
    return JSON.stringify(r);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
