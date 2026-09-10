// _hud_probe.mjs - invoke hud_probe_url for "plain" and "query" and print both results
const CDP_HTTP = "http://127.0.0.1:9222";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`${CDP_HTTP}/json`)).json();
      const p = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (p) return p.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error("no CDP page target");
}

const ws = new WebSocket(await pageWs());
const pending = new Map();
let seq = 0;
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
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
await send("Runtime.enable");

const invoke = (command, params) =>
  send("Runtime.evaluate", {
    expression: `(async () => { try { const r = await window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(params)}); return 'OK ' + JSON.stringify(r); } catch (e) { return 'ERR ' + String(e); } })()`,
    returnByValue: true,
    awaitPromise: true,
  }).then((m) => m.result?.result?.value ?? JSON.stringify(m.result ?? m));

for (const kind of ["plain", "query"]) {
  console.log(`hud_probe_url(${kind}) ->`, await invoke("hud_probe_url", { kind }));
}
ws.close();
