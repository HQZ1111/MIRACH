/**
 * 验证登录页第四轮：HERMES 165px + 右侧水印图（上下对齐/10%/内容在上）+ select 令牌化
 */
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const EDGE = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
let ws = null, msgId = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = (e) => send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }).then(r => r.exceptionDetails ? Promise.reject(new Error(JSON.stringify(r.exceptionDetails))) : r.result.value);
const getJson = (port, p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: p }, r => { let b = ""; r.on("data", c => b += c); r.on("end", () => res(JSON.parse(b))); }).on("error", rej));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-l4-"));
  const edge = spawn(EDGE, [`--remote-debugging-port=9349`, `--user-data-dir=${dir}`, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-gpu", "--window-size=1600,900", "http://localhost:1420/?win=login"], { stdio: "ignore" });
  let tabs = null; for (let i = 0; i < 60; i++) { try { tabs = await getJson(9349, "/json"); break; } catch { await sleep(500); } }
  ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await sleep(3500);

  console.log("[1] HERMES 字号 / 水印图:", JSON.stringify(await evalJs(`(() => {
    const h1 = document.querySelector("h1");
    const panel = h1?.closest(".w-1\\\\/3");
    const imgs = [...document.images];
    const overlay = imgs.find(i => getComputedStyle(i).opacity === "0.1");
    const panelRect = panel?.getBoundingClientRect();
    const oRect = overlay?.getBoundingClientRect();
    return {
      h1FontSize: h1 ? getComputedStyle(h1).fontSize : null,
      overlayFound: !!overlay,
      overlaySrc: overlay ? (overlay.src || "").slice(-20) : null,
      overlayOpacity: overlay ? getComputedStyle(overlay).opacity : null,
      overlayPointerEvents: overlay ? getComputedStyle(overlay).pointerEvents : null,
      overlayPosition: overlay ? getComputedStyle(overlay).position : null,
      overlayZ: overlay ? getComputedStyle(overlay).zIndex : null,
      h1Z: h1 ? getComputedStyle(h1).zIndex : null,
      h1Position: h1 ? getComputedStyle(h1).position : null,
      // 上下对齐：图顶/底是否贴面板
      topAligned: panelRect && oRect ? Math.abs(oRect.top - panelRect.top) < 2 : null,
      bottomAligned: panelRect && oRect ? Math.abs(oRect.bottom - panelRect.bottom) < 2 : null,
    };
  })()`), null, 2));

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
  await sleep(300);

  console.log("[2] 供应商/协议 select 令牌:", JSON.stringify(await evalJs(`(() => {
    const labels = [...document.querySelectorAll("label")].map(l => l.innerText);
    const selects = [...document.querySelectorAll("select")];
    return {
      selectCount: selects.length,
      allToken: selects.every(s => s.classList.contains("dropdown-select")),
      selects: selects.map(s => ({
        parentLabel: s.closest("label")?.querySelector("span")?.innerText ?? null,
        border: getComputedStyle(s).borderColor,
        bg: getComputedStyle(s).backgroundColor,
        radius: getComputedStyle(s).borderRadius,
        appearance: getComputedStyle(s).appearance,
        hasChevronSibling: !!s.parentElement?.querySelector(".lucide-chevron-down"),
      })),
    };
  })()`), null, 2));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
