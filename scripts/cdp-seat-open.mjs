// click the official model seat trigger and dump its menu content + confirm custom ds model appears
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
  console.log("menu open:", await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat button');
    if (!seat) return 'no seat trigger';
    const r = seat.getBoundingClientRect();
    window.__seatPt = { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    return 'found at ' + JSON.stringify(window.__seatPt);
  })()`));
  const rawPt = await rawEval(`window.__seatPt`);
  if (!rawPt) process.exit(0);
  const pp = (typeof rawPt === "string" ? JSON.parse(rawPt) : rawPt);
  if (!pp || typeof pp.x !== "number") { console.log("bad pt", rawPt); process.exit(0); }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pp.x, y: pp.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pp.x, y: pp.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pp.x, y: pp.y, button: "left", clickCount: 1 });
  await sleep(1200);
  console.log("menu:", await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat');
    const menu = seat?.querySelector('[role="menu"], [class*="_menu"]');
    const expanded = seat?.querySelector('button')?.getAttribute('aria-expanded');
    return JSON.stringify({ expanded, text: (menu?.innerText ?? '(no menu yet)').slice(0, 700) });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
