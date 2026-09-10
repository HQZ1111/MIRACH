// _hud_inspect.mjs — 只看 HUD（?win=hud）那个 page target 的 DOM/CSS/尺寸
// 用法：node scripts/_hud_inspect.mjs [js表达式] [port]
const [, , exprArg, portArg] = process.argv;
const PORT = Number(portArg || process.env.MIRACH_CDP_PORT || 9222);
const CDP_HTTP = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const list = await (await fetch(`${CDP_HTTP}/json/list`)).json();
const page = list.find((t) => t.type === "page" && (t.url || "").includes("win=hud"));
if (!page) {
  console.error("no HUD target; targets = " + JSON.stringify(list.map((t) => t.url)));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
});
const sendCmd = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});
await sendCmd("Runtime.enable");

const DEFAULT = `(() => {
  const root = document.getElementById('root');
  const cs = (el) => el ? getComputedStyle(el) : null;
  const info = (el) => el ? {
    rect: [Math.round(el.getBoundingClientRect().x), Math.round(el.getBoundingClientRect().y),
           Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
    display: cs(el).display, vis: cs(el).visibility, op: cs(el).opacity,
    bg: cs(el).backgroundColor, color: cs(el).color,
    cls: String(el.className || '').slice(0, 70),
  } : null;
  return JSON.stringify({
    url: location.href,
    title: document.title,
    viewport: [window.innerWidth, window.innerHeight],
    bodyText: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 400),
    rootChildren: root ? root.children.length : -1,
    htmlBg: cs(document.documentElement).backgroundColor,
    bodyBg: document.body ? cs(document.body).backgroundColor : null,
    shellCount: document.querySelectorAll('[data-hud-shell]').length,
    shell: info(document.querySelector('[data-hud-shell]')),
    composerCards: document.querySelectorAll('[data-composer-card]').length,
    card: info(document.querySelector('[data-composer-card]')),
    chatSurface: info(document.querySelector('[data-hud-chat-surface]')),
    topbar: info(document.querySelector('[data-hud-topbar]')),
    allCards: [...document.querySelectorAll('[data-composer-card]')].slice(0, 3).map(info),
  }, null, 1);
})()`;

const expression = exprArg ? `(async () => { ${exprArg} })()` : DEFAULT;
const res = await sendCmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (res.exceptionDetails) {
  console.error("eval failed: " + JSON.stringify(res.exceptionDetails).slice(0, 900));
  process.exit(1);
}
console.log(typeof res.result?.value === "string" ? res.result.value : JSON.stringify(res.result?.value));
ws.close();
