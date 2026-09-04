// context: these functions run in the OLD module scope after reload; read DOM slot tree directly
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
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await evalJs(`(() => {
    const mir = document.querySelector('[data-kernel-mirror]');
    if (!mir) return "no mirror";
    const head = mir.innerHTML.slice(0, 400);
    const texts = (mir.innerText ?? "").slice(0, 300);
    const btnCount = mir.querySelectorAll("button").length;
    const slots = [...mir.querySelectorAll("[data-slot]")].map(e => e.getAttribute("data-slot"));
    return JSON.stringify({ head, texts, btnCount, slots: [...new Set(slots)] });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
