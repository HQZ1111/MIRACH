// CDP driver for Hermes Desktop (WebView2 remote debugging, text-based, no vision).
// 1) wait for page target, 2) disable startup lock (localStorage, password data kept),
// 3) send a real message through the composer, 4) wait for the assistant reply,
// 5) dump visible text + DOM proof, 6) restore lock state.
const CDP_HTTP = "http://127.0.0.1:9222";
const TEST_TEXT = "你好，用一句话介绍你自己，不要调用任何工具。";
const RCP = ["Runtime.enable", "Page.enable", "Input.setIgnoreInputEvents"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${CDP_HTTP}/json`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1000);
  }
  throw new Error("no CDP page target");
}

let seq = 0;
const pending = new Map();
let ws;

function sendCmd(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evalJs(expr) {
  const r = await sendCmd("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
  return r.result?.value;
}

async function connect() {
  const url = await getPageWs();
  console.log("[cdp] target:", url);
  ws = new WebSocket(url);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = (e) => reject(new Error("ws error " + e.message));
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  };
  for (const m of RCP) await sendCmd(m);
  console.log("[cdp] connected");
}

async function waitFor(expr, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const v = await evalJs(expr);
      if (v) return v;
    } catch {}
    await sleep(500);
  }
  throw new Error("timeout waiting for " + label);
}

async function main() {
  await connect();
  console.log("[phase] current lock keys:", await evalJs(`JSON.stringify({enabled: localStorage.getItem('hermes.password.enabled.v1'), hasPw: !!localStorage.getItem('hermes.password.v1'), hasObf: !!localStorage.getItem('hermes.password.obf.v1')})`));

  // ---- step 2: bypass lock (password data untouched) ----
  await evalJs(`localStorage.setItem('hermes.password.enabled.v1','false'); location.reload(); true`);
  console.log("[phase] lock disabled, page reloading");
  await sleep(2500);

  // ---- step 3: focus composer + type + Enter ----
  await waitFor(`!!document.querySelector('textarea')`, 30000, "composer textarea");
  console.log("[phase] composer found");
  const taInfo = await evalJs(`(() => { const t = document.querySelector('textarea'); const r = t.getBoundingClientRect(); return JSON.stringify({x:r.x+r.width/2, y:r.y+r.height/2, ph: t.placeholder}); })()`);
  console.log("[phase] textarea:", taInfo);

  const { x, y } = JSON.parse(taInfo);
  await sendCmd("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await sendCmd("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(300);
  await sendCmd("Input.insertText", { text: TEST_TEXT });
  await sleep(300);
  const typed = await evalJs(`document.querySelector('textarea').value`);
  console.log("[phase] typed value:", JSON.stringify(typed));
  await sendCmd("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sendCmd("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  console.log("[phase] Enter sent at", new Date().toISOString());

  // ---- step 4: wait for assistant reply (user msg visible, then reply appears) ----
  await waitFor(`document.body.innerText.includes('${TEST_TEXT.slice(0, 6)}')`, 15000, "user message in DOM");
  console.log("[phase] user message rendered");
  await sleep(2000);
  const gotReply = await waitFor(
    `(() => { const t = document.body.innerText; const hasBusy = t.includes('回复中') || t.includes('思考中') || t.includes('工作中'); return hasBusy ? false : t; })()`,
    180000,
    "assistant reply (idle)"
  );
  console.log("[phase] reply rendered, idle");

  // ---- step 5: dump proof ----
  const dump = await evalJs(`document.body.innerText`);
  console.log("=====BODY-TEXT-START=====");
  console.log(dump.slice(0, 6000));
  console.log("=====BODY-TEXT-END=====");

  // ---- step 6: restore lock ----
  await evalJs(`localStorage.setItem('hermes.password.enabled.v1','true'); location.reload(); true`);
  console.log("[phase] lock restored, reloaded");
  await sleep(1500);
  console.log("[done] ok");
  process.exit(0);
}

main().catch((e) => {
  console.error("[fatal]", e.message);
  process.exit(1);
});
