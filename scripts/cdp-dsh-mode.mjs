// Open conversation: set chatStyle=dsh (localStorage), reload, then set the ACTIVE mirach session & trigger native open path (NativeChatArea onReady). Then dump mirror.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 500);
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await send("Page.enable");
  console.log(await rawEval(`localStorage.setItem('mirach.chatStyle','dsh'); 'set'`));
  await send("Page.reload", { ignoreCache: true });
  await sleep(25000);
  console.log("page:", await rawEval(`(() => ({
    iw: innerWidth, ih: innerHeight, title: document.title,
    bodyText: (document.body?.innerText ?? '').slice(0, 200),
  }))()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
