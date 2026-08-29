/**
 * 验证登录页水印图：inset-0 + object-cover 铺满整个右面板（四边全贴合）
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-l5-"));
  const edge = spawn(EDGE, [`--remote-debugging-port=9350`, `--user-data-dir=${dir}`, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-gpu", "--window-size=1600,900", "http://localhost:1420/?win=login"], { stdio: "ignore" });
  let tabs = null; for (let i = 0; i < 60; i++) { try { tabs = await getJson(9350, "/json"); break; } catch { await sleep(500); } }
  ws = new WebSocket(tabs.find(t => t.type === "page").webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  await sleep(3500);

  console.log("[水印图铺满验证]", JSON.stringify(await evalJs(`(() => {
    const h1 = document.querySelector("h1");
    const innerScroll = h1?.parentElement; // 内层滚动 div
    const panel = innerScroll?.parentElement; // 外层 w-1/3 面板（非滚动）
    // 水印 wrapper（外层直接子级：absolute inset-0 z-20）
    const wrap = [...(panel?.children || [])].find(c => c.classList.contains("inset-0") && c.classList.contains("z-20"));
    const overlay = wrap?.querySelector("img");
    const pr = panel?.getBoundingClientRect();
    const wr = wrap?.getBoundingClientRect();
    const or = overlay?.getBoundingClientRect();
    const ocs = overlay ? getComputedStyle(overlay) : null;
    const wcs = wrap ? getComputedStyle(wrap) : null;
    return {
      wrapFound: !!wrap,
      overlayFound: !!overlay,
      overlaySrc: overlay ? (overlay.src || "").slice(-20) : null,
      // wrapper 尺寸：== 面板
      wrapW: wr ? Math.round(wr.width) : null, panelW: pr ? Math.round(pr.width) : null,
      wrapH: wr ? Math.round(wr.height) : null, panelH: pr ? Math.round(pr.height) : null,
      // img 尺寸：== wrapper
      imgW: or ? Math.round(or.width) : null, imgH: or ? Math.round(or.height) : null,
      // 四边贴合（<2px 即视为对齐）
      topAligned: pr && wr ? Math.abs(wr.top - pr.top) < 2 : null,
      bottomAligned: pr && wr ? Math.abs(wr.bottom - pr.bottom) < 2 : null,
      leftAligned: pr && wr ? Math.abs(wr.left - pr.left) < 2 : null,
      rightAligned: pr && wr ? Math.abs(wr.right - pr.right) < 2 : null,
      // 样式
      wrapPosition: wcs ? wcs.position : null,
      wrapZ: wcs ? wcs.zIndex : null,
      wrapPointerEvents: wcs ? wcs.pointerEvents : null,
      imgObjectFit: ocs ? ocs.objectFit : null,
      imgOpacity: ocs ? ocs.opacity : null,
      h1Z: h1 ? getComputedStyle(h1).zIndex : null,
    };
  })()`), null, 2));

  ws.close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
