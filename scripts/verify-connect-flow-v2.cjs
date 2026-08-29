/**
 * 验证 2026-08-14 登录页连接流程改造：
 * A（?win=login）：
 *  1. 测试连接成功 → 绿色「连接成功」状态，但【无「进入主页」按钮】（保存后才出现）
 *  2. 点「保存」→ 出现「进入主页」按钮
 *  3. localStorage hermes.providerConfig.v1 落盘：明文 apiKey + baseURL + protocol + models + connected
 *  4. 字段改动后 saved 重置（进入按钮消失，回到 测试/保存 组）
 * B（主界面）：⌘K 命令面板 → 设置 → 模型分区主模型下拉显示同一份配置
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9354, URL = "http://localhost:1420/?win=login";
const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-cf2-"));
let ws = null, msgId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = (e) => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }).then(r => r.exceptionDetails ? Promise.reject(new Error(JSON.stringify(r.exceptionDetails))) : r.result.value);
const getJson = (p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: p }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res(JSON.parse(b))); }).on("error", rej));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function connectPage() {
  const page = (await getJson("/json")).find(t => t.type === "page");
  const s = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { s.onopen = res; s.onerror = rej; });
  const pend = new Map(); let mid = 0;
  s.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const run = (e) => new Promise((res, rej) => { const id = ++mid; pend.set(id, { res, rej }); s.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: e, returnByValue: true, awaitPromise: true } })); });
  return { ws: s, evalJs: run };
}

(async () => {
  const edge = spawn(EDGE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${USER_DIR}`, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-gpu", "--window-size=1600,900", URL], { stdio: "ignore" });
  let tabs = null; for (let i = 0; i < 60; i++) { try { tabs = await getJson("/json"); break; } catch { await sleep(500); } }
  ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  for (let i = 0; i < 40; i++) { if (await evalJs(`!!document.querySelector("h1")`)) break; await sleep(250); }
  await sleep(300);

  // ---- 密码 → connect 阶段 ----
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
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); return true; })()`);
  await sleep(250);

  // ---- 填 key + baseURL + 添加模型行 → 测试连接（不保存）----
  await evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const set = (el, v) => { setV.call(el, v); el.dispatchEvent(new Event("input", { bubbles: true })); };
    set([...document.querySelectorAll("input[type=password]")][0], "sk-test-1234567890abcdef");
    set(document.querySelector('input[placeholder*="https://api.deepseek.com"]'), "https://api.deepseek.com");
    return true;
  })()`);
  await sleep(150);
  // 展开「自定义设置」details → 添加模型行（deepseek-chat）—— 验证保存后设置页模型下拉能显示
  await evalJs(`(() => { [...document.querySelectorAll("summary")].find(b => b.innerText.includes("自定义设置")).click(); return true; })()`);
  await sleep(250);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "添加模型").click(); return true; })()`);
  await sleep(150);
  await evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setV.call(document.querySelector('input[placeholder="模型 id"]'), "deepseek-chat");
    document.querySelector('input[placeholder="模型 id"]').dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(150);
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("测试连接")).click(); return true; })()`);
  await sleep(900);

  const afterTest = await evalJs(`(() => {
    const btns = [...document.querySelectorAll("button")].map(b => b.innerText.trim());
    return {
      hasEnter: btns.includes("进入主页"),
      hasSave: btns.includes("保存"),
      hasTest: btns.includes("测试连接"),
      okStatus: [...document.querySelectorAll("p")].some(p => p.innerText.includes("连接成功")),
    };
  })()`);
  console.log("[A1] 测试连接成功后:", JSON.stringify(afterTest));

  // ---- 点保存 → 应出现「进入主页」----
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "保存").click(); return true; })()`);
  await sleep(900);

  const afterSave = await evalJs(`(() => {
    const btns = [...document.querySelectorAll("button")].map(b => b.innerText.trim());
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem("hermes.providerConfig.v1") ?? "{}"); } catch {}
    const ds = cfg?.deepseek;
    return {
      hasEnter: btns.includes("进入主页"),
      hasSave: btns.includes("保存"),
      cfgSaved: !!ds,
      apiKeyPlain: ds?.apiKey ?? null,
      baseURL: ds?.baseURL ?? null,
      protocol: ds?.protocol ?? null,
      connected: ds?.connected ?? null,
      models: ds?.models?.map((m) => m.id) ?? null,
      activeModelId: ds?.activeModelId ?? null,
    };
  })()`);
  console.log("[A2] 保存后:", JSON.stringify(afterSave));

  // ---- 改动字段 → saved 重置 ----
  await evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const i = [...document.querySelectorAll("input[type=password]")][0];
    setV.call(i, "sk-test-9999"); i.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await sleep(300);
  const afterEdit = await evalJs(`(() => {
    const btns = [...document.querySelectorAll("button")].map(b => b.innerText.trim());
    return { hasEnter: btns.includes("进入主页"), hasSave: btns.includes("保存") };
  })()`);
  console.log("[A3] 改动 key 后:", JSON.stringify(afterEdit));

  // ---- B：主界面设置页同步 ----
  // 用 CDP Target.createTarget 新建主界面 tab（headless 下 window.open 会被拦截）
  const newTarget = await send("Target.createTarget", { url: "http://localhost:1420/" });
  await sleep(2500);
  const mainTab = (await getJson("/json")).find(t => t.id === newTarget.targetId);
  if (!mainTab) { console.log("[B] 主界面 tab 未创建"); ws.close(); edge.kill(); process.exit(1); }
  const m = await connectPage();
  await m.evalJs(`new Promise(r => setTimeout(r, 2500)); true`).catch(() => {});

  // 命令面板快捷键 ctrl+k
  await m.evalJs(`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true, cancelable: true })); return true; })()`);
  await sleep(500);
  const paletteInfo = await m.evalJs(`(() => ({
    input: [...document.querySelectorAll("input")].map(i => i.placeholder).filter(Boolean).slice(0, 5),
    bodyHasSettings: document.body.innerText.includes("设置"),
  }))()`);
  console.log("[B1] 命令面板:", JSON.stringify(paletteInfo));

  // 输入「设置」过滤 + 点击动作
  await m.evalJs(`(() => {
    const setV = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    const target = [...document.querySelectorAll("input")].find(i => /搜索|search|命令|command/i.test(i.placeholder || ""));
    if (target) { setV.call(target, "设置"); target.dispatchEvent(new Event("input", { bubbles: true })); }
    return true;
  })()`);
  await sleep(400);
  const clickRes = await m.evalJs(`(() => {
    const btn = [...document.querySelectorAll("button, [role=option]")].find(b => b.innerText.trim().startsWith("设置"));
    if (btn) { btn.click(); return "clicked:" + btn.innerText.trim(); }
    return "not-found";
  })()`);
  console.log("[B2] 点设置:", clickRes);
  await sleep(800);

  // 模型分区主模型下拉值 + 应用按钮持久化
  const modelContent = await m.evalJs(`(() => {
    const selects = [...document.querySelectorAll("select")].map(s => ({ val: s.value, options: [...s.options].map(o => o.text).slice(0, 8) }));
    const hint = [...document.querySelectorAll("p")].map(p => p.innerText).find(t => t.includes("api.deepseek.com")) ?? null;
    return { selects, hint, bodyHasModel: document.body.innerText.includes("主模型") };
  })()`);
  console.log("[B3] 模型分区:", JSON.stringify(modelContent, null, 2));

  // 选中 deepseek-chat → 点「应用」→ localStorage activeModelId 更新
  const applyRes = await m.evalJs(`(() => {
    const sel = [...document.querySelectorAll("select")].find(s => [...s.options].some(o => o.text === "deepseek-chat"));
    if (!sel) return "model-select-not-found";
    const setV = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
    setV.call(sel, "deepseek-chat");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "selected";
  })()`);
  console.log("[B4] 选模型:", applyRes);
  await sleep(300);
  await m.evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.trim() === "应用" || b.innerText.trim() === "Apply").click(); return true; })()`);
  await sleep(500);
  const applied = await m.evalJs(`(() => {
    let cfg = null;
    try { cfg = JSON.parse(localStorage.getItem("hermes.providerConfig.v1") ?? "{}"); } catch {}
    const ds = cfg?.deepseek;
    return { activeModelId: ds?.activeModelId ?? null, flash: [...document.querySelectorAll("button")].some(b => b.innerText.includes("已应用")) };
  })()`);
  console.log("[B5] 应用后:", JSON.stringify(applied));

  ws.close(); m.ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
