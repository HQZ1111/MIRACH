/* 验证登录页（?win=login）：headless Edge + CDP，仅读 DOM/文本（模型无视觉） */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;
const URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-cdp-"));

let ws = null;
let msgId = 0;
const pending = new Map();

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

function evalJs(expr) {
  return send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
  }).then((r) => {
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  });
}

const getJson = (p) =>
  new Promise((res, rej) => {
    http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => {
      let b = "";
      r.on("data", (c) => (b += c));
      r.on("end", () => res(JSON.parse(b)));
    }).on("error", rej);
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const edge = spawn(EDGE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DIR}`,
    "--headless=new",
    "--no-sandbox",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-gpu",
    "--window-size=1600,900",
    URL,
  ], { stdio: "ignore" });

  // 等待调试端口可用
  let tabs = null;
  for (let i = 0; i < 60; i++) {
    try { tabs = await getJson("/json"); break; } catch { await sleep(500); }
  }
  if (!tabs) throw new Error("CDP 端口不可用");

  const page = tabs.find((t) => t.type === "page");
  const { webSocketDebuggerUrl } = page;
  ws = new WebSocket(webSocketDebuggerUrl); // Node 22 原生 WebSocket
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data.toString());
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) reject(new Error(JSON.stringify(m.error)));
      else resolve(m.result);
    }
  };

  // 等待 React 渲染
  for (let i = 0; i < 40; i++) {
    const has = await evalJs(`!!document.querySelector("h1")`);
    if (has) break;
    await sleep(250);
  }

  const report = await evalJs(`(() => {
    const q = (s) => document.querySelector(s);
    const h1 = q("h1"), h2 = q("h2");
    const inputs = [...document.querySelectorAll("input")].map(i => i.placeholder || i.type);
    const buttons = [...document.querySelectorAll("button")].map(b => (b.innerText.trim() || b.title || b.ariaLabel || "").slice(0, 20));
    const img = q("img");
    const rightPanel = h1?.parentElement;
    const leftPanel = img?.parentElement;
    const card = rightPanel?.parentElement;
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const crBtn = [...document.querySelectorAll("button")].find(b => b.querySelector("svg") && getComputedStyle(b).position === "absolute");
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      h1: { text: h1?.textContent, fs: h1 ? getComputedStyle(h1).fontSize : null, fw: h1 ? getComputedStyle(h1).fontWeight : null },
      h2: { text: h2?.textContent, fs: h2 ? getComputedStyle(h2).fontSize : null, fw: h2 ? getComputedStyle(h2).fontWeight : null },
      inputs,
      buttons,
      img: img ? { scale: getComputedStyle(img).scale, rect: rect(img), natural: [img.naturalWidth, img.naturalHeight] } : null,
      leftPanel: leftPanel ? rect(leftPanel) : null,
      rightPanel: rightPanel ? rect(rightPanel) : null,
      card: card ? rect(card) : null,
      crBtn: crBtn ? rect(crBtn) : null,
      bodyText: document.body.innerText.slice(0, 150),
    };
  })()`);

  console.log(JSON.stringify(report, null, 2));
  ws.close();
  edge.kill();
  process.exit(0);
})().catch((e) => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
