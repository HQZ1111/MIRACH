const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9337, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-c4-"));
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

  const step1 = await evalJs(`(() => {
    const h1 = document.querySelector("h1");
    const panel = h1.parentElement;
    const r = el => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), w: Math.round(b.width), right: Math.round(b.right) }; };
    const h1r = r(h1), pr = r(panel);
    const corner = [...document.querySelectorAll("button")].filter(b => b.querySelector("svg") && getComputedStyle(b).position === "absolute");
    return {
      h1fs: getComputedStyle(h1).fontSize,
      h1w: h1r.w, h1right: h1r.right, panelRight: pr.right,
      h1OverflowsPanel: h1r.right > pr.right,
      cornerButtons: corner.length,
    };
  })()`);

  // 填密码 + 保存
  await evalJs(`(() => {
    const inputs = document.querySelectorAll("input[type=password]");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(inputs[0], "1234"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setV.call(inputs[1], "1234"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(120);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存").click(); return true; })()`);
  await sleep(350);

  const step2 = await evalJs(`(() => {
    const btns = [...document.querySelectorAll("button")].map(b => (b.innerText.trim().split(String.fromCharCode(10))[0] || b.title || "").slice(0, 14));
    const corner = [...document.querySelectorAll("button")].filter(b => b.querySelector("svg") && getComputedStyle(b).position === "absolute");
    const h3 = document.querySelector("h3");
    return { h3: h3?.textContent, sub: h3?.nextElementSibling?.textContent, btns, cornerButtons: corner.length };
  })()`);

  // 展开 我有 API 密钥
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); return true; })()`);
  await sleep(200);
  let step3; try { step3 = await evalJs(`(() => ({
    selects: [...document.querySelectorAll("select")].map(s => s.options[0]?.text + ".." + s.value),
    inputs: [...document.querySelectorAll("input")].map(i => i.placeholder || i.type).filter(Boolean),
    hasDetails: !!document.querySelector("details"),
    summaryText: document.querySelector("details summary")?.innerText.trim(),
  }))()`);

  // 展开 自定义端点
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("自定义端点")).click(); return true; })()`);
  await sleep(200);
  } catch(e){step3={ERR:String(e)}} let step4; try { step4 = await evalJs(`(() => ({
    inputs: [...document.querySelectorAll("input")].map(i => i.placeholder || i.type).filter(Boolean),
    selects: [...document.querySelectorAll("select")].map(s => s.value),
    addModelBtn: !!document.querySelector("button[title='删除该模型']") || [...document.querySelectorAll("button")].some(b => b.innerText.includes("添加模型")),
  }))()`);

  // 展开自定义设置里的模型列表 → 添加模型 → 检查容量字段
  await evalJs(`(() => { const d = document.querySelector("details"); d.open = true; [...document.querySelectorAll("button")].find(b => b.innerText.includes("添加模型")).click(); return true; })()`);
  await sleep(150);
  } catch(e){step4={ERR:String(e)}} let step5; try { step5 = await evalJs(`(() => ({
    modelRows: [...document.querySelectorAll("input")].map(i => i.placeholder).filter(p => p === "模型 id" || p === "名称" || p === "256K" || p === "32K").length,
    placeholders: [...document.querySelectorAll("input")].map(i => i.placeholder).filter(Boolean).slice(-8),
  }))()`);

  } catch(e){step5={ERR:String(e)}}
  console.log("STEP1 h1/角标:", JSON.stringify(step1, null, 2));
  console.log("STEP2 连接面板:", JSON.stringify(step2, null, 2));
  console.log("STEP3 APIkey表单:", JSON.stringify(step3, null, 2));
  console.log("STEP4 自定义表单:", JSON.stringify(step4, null, 2));
  console.log("STEP5 模型列表:", JSON.stringify(step5, null, 2));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
