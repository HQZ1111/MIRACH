// _page_recon.mjs — 查每个 page target 的渲染状态 + 重载一次抓 console/异常
const PORT = Number(process.argv[2] || 9222);
const RELOAD = process.argv.includes("--reload");
const WAIT = Number(process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : 8000);
const list = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === "page");

for (const t of list) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let seq = 0;
  const pending = new Map();
  const events = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(typeof ev.data === "string" ? ev.data : "");
    if (m.id) {
      const q = pending.get(m.id);
      if (!q) return;
      pending.delete(m.id);
      if (m.error) q.reject(new Error(JSON.stringify(m.error)));
      else q.resolve(m.result);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      events.push("[exception] " + (d.text || "") + " " + (d.exception?.description || "").slice(0, 400));
    } else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
      events.push("[console." + m.params.type + "] " + (m.params.args || []).map((a) => a.value ?? a.description ?? a.type).join(" ").slice(0, 400));
    } else if (m.method === "Log.entryAdded" && ["error", "warning"].includes(m.params.entry?.level)) {
      events.push("[log." + m.params.entry.level + "] " + (m.params.entry.text || "").slice(0, 300));
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });
    await send("Runtime.enable");
    await send("Log.enable");
    if (RELOAD) {
      await send("Page.enable");
      await send("Page.reload", {});
      await new Promise((r) => setTimeout(r, WAIT));
    }
    const r = await send("Runtime.evaluate", {
      expression: `JSON.stringify({
        url: location.href, rs: document.readyState, title: document.title,
        rootKids: document.getElementById('root')?.children.length ?? -1,
        bodyLen: (document.body.innerText || '').length,
        htmlLen: document.documentElement.outerHTML.length,
        scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).slice(0, 4),
        resources: performance.getEntriesByType('resource').length,
        hasIpc: typeof window.__TAURI_INTERNALS__,
        lastRes: performance.getEntriesByType('resource').slice(-3).map((x) => x.name.replace(location.origin, '')),
      })`,
      returnByValue: true,
    });
    console.log(`=== ${t.url} ===`);
    console.log(r.result?.value);
    if (events.length) console.log(events.slice(-12).join("\n"));
  } catch (e) {
    console.log(`=== ${t.url} === ERR ${e.message}`);
  }
  ws.close();
}
