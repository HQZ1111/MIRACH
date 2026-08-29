const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9336, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-c3-"));
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

  // 填两个密码框 + 点「保存」
  await evalJs(`(() => {
    const inputs = document.querySelectorAll("input[type=password]");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(inputs[0], "1234"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setV.call(inputs[1], "1234"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存");
    btn.click(); return true;
  })()`);
  await sleep(400);

  const report = await evalJs(`(() => {
    const body = document.body.innerText;
    const btns = [...document.querySelectorAll("button")].map(b => (b.innerText.trim().split(String.fromCharCode(10))[0] || b.title || "").slice(0, 16));
    const q = s => document.querySelector(s);
    const h3 = q("h3");
    const cr = [...document.querySelectorAll("button")].find(b => b.querySelector("svg") && getComputedStyle(b).position === "absolute");
    return {
      phaseText: body.slice(0, 200),
      buttons: btns,
      crTitle: cr?.title,
      hasKeyOption: body.includes("我有 API 密钥"),
      hasEndpointOption: body.includes("自定义端点"),
      h3: h3 ? h3.textContent : null,
      p: h3?.nextElementSibling?.textContent ?? null,
    };
  })()`);
  console.log(JSON.stringify(report, null, 2));

  // 展开「我有 API 密钥」→ 检查下拉/输入框
  await evalJs(`(() => { const b = [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")); b.click(); return true; })()`);
  await sleep(200);
  console.log("--- 展开 API key 后 ---");
  console.log(JSON.stringify(await evalJs(`(() => ({ selects: [...document.querySelectorAll("select")].map(s => s.value + ":" + s.options.length + "项"), inputs: [...document.querySelectorAll("input")].map(i => i.placeholder || i.type) }))()`), null, 2));

  // 收起，展开「自定义端点」
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); [...document.querySelectorAll("button")].find(b => b.innerText.includes("自定义端点")).click(); return true; })()`);
  await sleep(200);
  console.log("--- 展开 自定义端点 后 ---");
  console.log(JSON.stringify(await evalJs(`(() => ({ inputs: [...document.querySelectorAll("input")].map(i => i.placeholder || i.type), btns: [...document.querySelectorAll("button")].map(b => (b.innerText.trim()||b.title).slice(0,10)) }))()`), null, 2));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
