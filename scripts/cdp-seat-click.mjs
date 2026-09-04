// click seat via DOM .click() directly (React handler) and dump menu
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log("click:", await rawEval(`(() => {
    const b = document.querySelector('.native-model-seat button');
    if (!b) return 'no trigger';
    b.click();
    return 'clicked';
  })()`));
  await sleep(1200);
  console.log("state:", await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat');
    const b = seat?.querySelector('button');
    const menus = seat ? [...seat.querySelectorAll('*')].filter(e => e.children.length === 0).map(e => e.textContent).filter(Boolean).slice(0, 20) : [];
    const anyVisible = seat ? [...seat.querySelectorAll('[role="menu"], [class*="_menu"], [class*="_options"]')].map(e => e.innerText.slice(0, 60)) : [];
    return JSON.stringify({ expanded: b?.getAttribute('aria-expanded'), leaves: menus.slice(0, 12), visibleMenus: anyVisible });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
