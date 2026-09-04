// CDP: read viewport + innerWidth + documentElement clientWidth to know why 160x28
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 400) };
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(JSON.stringify(await evalJs(`(() => ({
    iw: window.innerWidth, ih: window.innerHeight,
    outerW: window.outerWidth, outerH: window.outerHeight,
    dpr: window.devicePixelRatio,
    dw: document.documentElement.clientWidth, dh: document.documentElement.clientHeight,
    visualW: window.visualViewport ? window.visualViewport.width : null,
    screen: { w: screen.width, h: screen.height, availW: screen.availWidth, availH: screen.availHeight },
  }))()`)));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
