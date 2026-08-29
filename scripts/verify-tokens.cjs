/**
 * 验证 2026-08-14：下拉/折叠卡片令牌化（.dropdown-card 系列 + --color-dropdown-*）
 * Part A（?win=login）：入口卡 + 自定义设置 details 用令牌类，chevron 旋转，暗色令牌覆盖
 * Part B（主界面 sessions 视图）：已置顶会话/项目 卡片用令牌类，折叠/展开，暗色覆盖
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

async function launch(port, url) {
  const USER_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "edge-c4-"));
  const edge = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${USER_DIR}`, "--headless=new", "--no-sandbox", "--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-gpu", "--window-size=1600,900", url], { stdio: "ignore" });
  let tabs = null; for (let i = 0; i < 60; i++) { try { tabs = await getJson(port, "/json"); break; } catch { await sleep(500); } }
  const page = tabs.find(t => t.type === "page");
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data.toString()); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  return edge;
}
const close = () => { try { ws && ws.close(); } catch {} };

(async () => {
  // ── Part A: 登录页 ──
  let edge = await launch(9346, "http://localhost:1420/?win=login");
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
  console.log("[A] 入口卡令牌:", JSON.stringify(await evalJs(`(() => {
    const btns = [...document.querySelectorAll("button")].filter(b => b.innerText.includes("我有 API 密钥") || b.innerText.includes("自定义端点"));
    return btns.map(b => {
      const card = b.closest(".dropdown-card");
      const chev = b.querySelector(".lucide-chevron-down");
      return {
        title: b.innerText.slice(0, 8),
        cardToken: !!card, triggerToken: b.classList.contains("dropdown-card-trigger"),
        chevronToken: chev?.classList.contains("dropdown-card-chevron") ?? null,
        cardRadius: card ? getComputedStyle(card).borderRadius : null,
        cardBorder: card ? getComputedStyle(card).borderColor : null,
        hasBodyToken: !!card?.querySelector(".dropdown-card-body"),
      };
    });
  })()`), null, 2));
  // 展开 我有 API 密钥 → 检查 details 令牌 + chevron 旋转 + 暗色覆盖
  await evalJs(`(() => { [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).click(); return true; })()`);
  await sleep(250);
  console.log("[A] details 令牌:", JSON.stringify(await evalJs(`(() => {
    const d = [...document.querySelectorAll("details")].find(x => x.innerText.includes("自定义设置"));
    const s = d?.querySelector("summary");
    const chev = s?.querySelector(".lucide-chevron-down");
    return {
      detailsToken: d?.classList.contains("dropdown-card") ?? null,
      triggerToken: s?.classList.contains("dropdown-card-trigger") ?? null,
      chevronToken: chev?.classList.contains("dropdown-card-chevron") ?? null,
      bodyToken: !!d?.querySelector(".dropdown-card-body"),
      chevRotateClosed: chev ? getComputedStyle(chev).rotate : null,
      listStyleNone: s ? getComputedStyle(s).listStyleType : null,
    };
  })()`), null, 2));
  await evalJs(`(() => { const d = [...document.querySelectorAll("details")].find(x => x.innerText.includes("自定义设置")); d.toggleAttribute("open"); return true; })()`);
  await sleep(250);
  console.log("[A] details 展开 chevron rotate:", await evalJs(`getComputedStyle([...document.querySelectorAll("details")].find(x => x.innerText.includes("自定义设置")).querySelector(".lucide-chevron-down")).rotate`));
  // 暗色令牌覆盖
  await evalJs(`(() => { document.documentElement.classList.add("dark"); return true; })()`);
  await sleep(250);
  console.log("[A] 暗色入口卡 bg:", await evalJs(`(() => {
    const card = [...document.querySelectorAll("button")].find(b => b.innerText.includes("我有 API 密钥")).closest(".dropdown-card");
    return getComputedStyle(card).backgroundColor;
  })()`));
  close(); edge.kill();
  await sleep(400);

  // ── Part B: 主界面 sessions 视图 ──
  edge = await launch(9347, "http://localhost:1420/");
  for (let i = 0; i < 60; i++) { if (await evalJs(`(document.body && document.body.innerText || "").includes("团队列表")`)) break; await sleep(300); }
  await sleep(800);
  await evalJs(`(() => {
    const aside = [...document.querySelectorAll("aside")].find(a => a.getBoundingClientRect().width > 0);
    const btn = aside && [...aside.querySelectorAll("button")].find(b => b.className.includes("text-heading"));
    btn.click(); return true;
  })()`);
  await sleep(500);
  for (let i = 0; i < 20; i++) { if (await evalJs(`document.body.innerText.includes("已置顶会话")`)) break; await sleep(250); }
  const cards = await evalJs(`(() => {
    return ["已置顶会话", "项目"].map(name => {
      const card = [...document.querySelectorAll(".dropdown-card")].find(d => d.innerText.includes(name));
      if (!card) return { name, found: false };
      const head = card.querySelector("button");
      const chev = head?.querySelector(".lucide-chevron-down");
      const trigger = card.querySelector("[data-state]");
      return {
        name, found: true,
        triggerToken: head?.classList.contains("dropdown-card-trigger") ?? null,
        iconToken: !!head?.querySelector(".dropdown-card-icon"),
        chevronToken: chev?.classList.contains("dropdown-card-chevron") ?? null,
        bodyToken: !!card.querySelector(".dropdown-card-body"),
        chevRotate: chev ? getComputedStyle(chev).rotate : null,
        triggerState: trigger?.getAttribute("data-state") ?? null,
        radius: getComputedStyle(card).borderRadius, border: getComputedStyle(card).borderColor,
      };
    });
  })()`);
  console.log("[B] 已置顶会话/项目卡片:", JSON.stringify(cards, null, 2));
  await evalJs(`(() => { const card = [...document.querySelectorAll(".dropdown-card")].find(d => d.innerText.includes("已置顶会话")); card.querySelector("button").click(); return true; })()`);
  await sleep(300);
  const afterCollapse = await evalJs(`(() => {
    const card = [...document.querySelectorAll(".dropdown-card")].find(d => d.innerText.includes("已置顶会话"));
    const chev = card?.querySelector("button .lucide-chevron-down");
    return { rotate: chev ? getComputedStyle(chev).rotate : null, state: card?.querySelector("[data-state]")?.getAttribute("data-state") ?? null };
  })()`);
  console.log("[B] 折叠后:", JSON.stringify(afterCollapse));
  close(); edge.kill(); process.exit(0);
})().catch(e => { console.error("ERR", e); try { ws && ws.close(); } catch {} process.exit(1); });
