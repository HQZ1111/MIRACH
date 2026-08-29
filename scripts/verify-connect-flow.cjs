/**
 * 验证登录连接流程（2026-08-14 第二轮修正）：
 * 1. 密码阶段右下角 >> 直接进入按钮存在（文档流，非 absolute）
 * 2. 保存密码后进入 connect 阶段，>> 按钮依然存在
 * 3. 下拉 = 一体化原生 select（appearance-none + 自绘 ChevronDown），非浮层面板
 * 4. 入口 = zosma CustomProviderRow 卡片：头部按钮 + 旋转 ChevronDown
 * 5. 测试连接：成功 → 绿色状态 + 「进入主页」；点击 → 淡出
 * 6. 失败路径：Base URL 含 bad → 红色「无法连接到」
 * 7. 内容展开后 >> 按钮被挤到下方（rect.top >= 卡片 bottom），不遮挡表单
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9340, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-cf-"));
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
  await sleep(300);

  const cornerInfo = `(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.querySelector(".lucide-chevrons-right"));
    return b ? { title: b.title, pos: getComputedStyle(b).position, rectTop: Math.round(b.getBoundingClientRect().top) } : null;
  })()`;

  console.log("[1] 密码阶段右下角按钮:", JSON.stringify(await evalJs(cornerInfo)));
  console.log("[1] 密码阶段 select 数量:", await evalJs(`document.querySelectorAll("select").length`));

  // 填密码 + 保存 → connect
  await evalJs(`(() => {
    const inputs = document.querySelectorAll("input[type=password]");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(inputs[0], "1234"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setV.call(inputs[1], "1234"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存").click(); return true; })()`);
  await sleep(400);

  const connect = await evalJs(`(() => ({
    h3: document.querySelector("h3")?.textContent ?? null,
    bodyHasKey: document.body.innerText.includes("我有 API 密钥"),
    bodyHasCustom: document.body.innerText.includes("自定义端点"),
  }))()`);
  console.log("[2] connect 阶段 h3:", connect.h3, "| 入口存在:", connect.bodyHasKey && connect.bodyHasCustom);
  console.log("[2] connect 阶段右下角按钮:", JSON.stringify(await evalJs(cornerInfo)));

  // 展开「我有 API 密钥」：卡片折叠 + 原生 select + chevron
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); return true; })()`);
  await sleep(250);
  const entry = await evalJs(`(() => {
    const card = [...document.querySelectorAll("div.rounded-xl")].find(d => d.innerText.includes("我有 API 密钥"));
    const head = card?.querySelector("button");
    const chev = head?.querySelector(".lucide-chevron-down");
    return {
      cardBorder: card ? getComputedStyle(card).borderColor : null,
      headRotated: chev ? chev.classList.contains("rotate-180") : null,
      hasBorderTopBody: !!card?.querySelector("div.border-t"),
      selects: [...card.querySelectorAll("select")].map(s => ({
        cls: s.className,
        appearanceNone: s.className.includes("appearance-none"),
        options: s.options.length,
        hasChevronSibling: !!s.parentElement.querySelector(".lucide-chevron-down"),
      })),
      noPortal: !document.querySelector("[data-provider-dropdown]"),
    };
  })()`);
  console.log("[3] 入口卡片:", JSON.stringify(entry, null, 2));

  // 填 key → 测试连接 → 成功 + 进入主页
  await evalJs(`(() => {
    const i = document.querySelector('input[placeholder="粘贴 API key…"]');
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(i, "sk-test-123"); i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(100);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("测试连接")).click(); return true; })()`);
  await sleep(500);
  const ok = await evalJs(`(() => {
    const green = [...document.querySelectorAll("p")].find(p => p.innerText.includes("连接成功"));
    const enter = [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "进入主页");
    return { green: green?.innerText ?? null, hasEnter: !!enter, enterColor: enter ? getComputedStyle(enter).backgroundColor : null };
  })()`);
  console.log("[5] 测试连接成功:", JSON.stringify(ok));
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "进入主页").click(); return true; })()`);
  await sleep(600);
  console.log("[5] 进入主页后 overlay opacity:", await evalJs(`getComputedStyle(document.querySelector(".fixed.inset-0")).opacity`));

  // 重新加载验证失败路径 + 按钮被内容挤下
  await evalJs(`location.reload(); true`);
  await sleep(1300);
  for (let i = 0; i < 40; i++) { if (await evalJs(`!!document.querySelector("h1")`)) break; await sleep(250); }
  await evalJs(`(() => {
    const inputs = document.querySelectorAll("input[type=password]");
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(inputs[0], "1234"); inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setV.call(inputs[1], "1234"); inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存").click(); return true; })()`);
  await sleep(400);

  // 展开前按钮位置 vs 展开后：展开自定义端点（内容变长）→ 按钮被挤下去
  const before = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.querySelector(".lucide-chevrons-right"));
    return Math.round(b.getBoundingClientRect().top);
  })()`);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("自定义端点")).click(); return true; })()`);
  await sleep(250);
  const after = await evalJs(`(() => {
    const b = [...document.querySelectorAll("button")].find(b => b.querySelector(".lucide-chevrons-right"));
    const card = [...document.querySelectorAll("div.rounded-xl")].find(d => d.innerText.includes("自定义端点"));
    return {
      cornerTop: Math.round(b.getBoundingClientRect().top),
      cardBottom: Math.round(card.getBoundingClientRect().bottom),
      pushedBelow: b.getBoundingClientRect().top >= card.getBoundingClientRect().bottom - 1,
    };
  })()`);
  console.log("[7] 展开前按钮 top:", before, "| 展开后:", JSON.stringify(after));

  // 失败路径：custom 表单 baseURL 含 bad
  await evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const set = (el, v) => { setV.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set(document.querySelector('input[placeholder="acme-gateway"]'), "acme-gw");
    set(document.querySelector('input[placeholder="https://gateway.example/v1"]'), "https://bad.example/v1");
    [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "添加模型").click();
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(document.querySelector('input[placeholder="模型 id"]'), "deepseek-chat");
    document.querySelector('input[placeholder="模型 id"]').dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("测试连接")).click(); return true; })()`);
  await sleep(500);
  const fail = await evalJs(`(() => {
    const red = [...document.querySelectorAll("p")].find(p => p.innerText.includes("无法连接到"));
    return { red: red?.innerText ?? null, color: red ? getComputedStyle(red).color : null, hasEnter: [...document.querySelectorAll("button")].some(b => b.innerText.trim() === "进入主页") };
  })()`);
  console.log("[6] 失败路径:", JSON.stringify(fail));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
