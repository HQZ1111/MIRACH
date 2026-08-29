const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9338, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-c5-"));
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
  // 保存密码 → 连接面板 → 打开 我有 API 密钥 → 展开 details → 添加模型
  await evalJs(`(() => {
    const inputs = document.querySelectorAll("input[type=password]");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(inputs[0], "1234"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setV.call(inputs[1], "1234"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存").click(); return true; })()`);
  await sleep(300);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); return true; })()`);
  await sleep(200);
  await evalJs(`(() => { document.querySelector("details").open = true; return true; })()`);
  await sleep(150);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("添加模型")).click(); return true; })()`);
  await sleep(150);
  const r1 = await evalJs(`(() => ({
    placeholders: [...document.querySelectorAll("input")].map(i => i.placeholder).filter(Boolean),
    modelCount: [...document.querySelectorAll("input")].filter(i => i.placeholder === "模型 id").length,
  }))()`);
  console.log("添加模型后:", JSON.stringify(r1, null, 2));

  // 展开模型行容量（点 chevron）+ 填容量 → 检查格式
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.title === "容量设置").click(); return true; })()`);
  await sleep(120);
  await evalJs(`(() => {
    const cw = [...document.querySelectorAll("input")].find(i => i.placeholder === "256K");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(cw, "256K"); cw.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
  const r2 = await evalJs(`(() => ({
    capacities: [...document.querySelectorAll("input")].filter(i => i.placeholder === "256K" || i.placeholder === "32K").map(i => i.value),
  }))()`);
  console.log("容量输入:", JSON.stringify(r2, null, 2));

  // 获取模型（mock getModels → 候选勾选）
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("获取模型")).click(); return true; })()`);
  await sleep(500);
  const r3 = await evalJs(`(() => ({
    candidates: [...document.querySelectorAll("li label")].map(l => l.innerText.trim()),
    hasAdopt: [...document.querySelectorAll("button")].some(b => b.innerText.includes("采纳所选")),
  }))()`);
  console.log("获取模型候选:", JSON.stringify(r3, null, 2));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
