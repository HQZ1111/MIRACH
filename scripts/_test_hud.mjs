// _test_hud.mjs - open the HUD via CDP, then read the HUD window's DOM text (does it render chat?)
const PORT = Number(process.argv[2] ?? 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function evalIn(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    p(m);
  });
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++seq;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await new Promise((res) => ws.addEventListener("open", res, { once: true }));
  await send("Runtime.enable");
  const out = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  if (out.exceptionDetails) return `THREW: ${JSON.stringify(out.exceptionDetails).slice(0, 300)}`;
  return out.result?.value;
}

let list = await targets();
console.log("targets before:", list.map((t) => t.url).join(" | "));
const main = list.find((t) => !t.url.includes("win=hud"));
console.log("main target:", main?.url);
console.log("hud_open ->", await evalIn(main.webSocketDebuggerUrl, "window.__TAURI_INTERNALS__.invoke('hud_open').then(() => 'ok').catch(e => 'ERR ' + e)"));
await sleep(9000);

list = await targets();
console.log("targets after:", list.map((t) => t.url).join(" | "));
const hud = list.find((t) => t.url.includes("win=hud"));
if (!hud) {
  console.log("NO HUD TARGET — window did not open or has no page");
  process.exit(0);
}
const info = await evalIn(
  hud.webSocketDebuggerUrl,
  `JSON.stringify({
     title: document.title,
     text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
     hasComposer: !!document.querySelector('[data-composer-card]'),
     hasChatSurface: !!document.querySelector('[data-hud-chat-surface]'),
     kernelCtx: typeof window.__DSH_BOOT__,
   })`,
);
console.log("HUD:", info);
