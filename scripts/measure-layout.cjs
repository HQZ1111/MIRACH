const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9335, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-m2-"));
let ws = null, msgId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = (e) => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }).then(r => r.exceptionDetails ? Promise.reject(new Error(JSON.stringify(r.exceptionDetails))) : r.result.value);
const getJson = (p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: p }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res(JSON.parse(b))); }).on("error", rej));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-gpu", "--window-size=1600,900", URL], { stdio: "ignore" });
  let tabs = null; for (let i = 0; i < 60; i++) { try { tabs = await getJson("/json"); break; } catch { await sleep(500); } }
  const page = tabs.find(t => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  for (let i = 0; i < 40; i++) { if (await evalJs(`!!document.querySelector("h1")`)) break; await sleep(250); }
  console.log(JSON.stringify(await evalJs(`(() => {
    const q = s => document.querySelector(s);
    const h1 = q("h1"), h2 = q("h2");
    const panel = h1.parentElement;
    const form = [...panel.querySelectorAll("div")].find(d => d.className.includes("mt-28"));
    const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right), bottom: Math.round(b.bottom) }; };
    const p = r(panel);
    return {
      h1: r(h1), h2: r(h2),
      h2RightAligned: Math.abs(r(h2).right - (p.x + p.w)) <= 2, // 右缘贴内容右缘？
      panel: p,
      form: form ? r(form) : null,
    };
  })()`), null, 2));
  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
