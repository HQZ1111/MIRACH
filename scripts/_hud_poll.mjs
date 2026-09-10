// _hud_poll.mjs — 轮询 HUD 页面的渲染进度（dev 冷缓存下会很慢，看它到底有没有在动）
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const COUNT = Number(process.argv[2] || 6);
const GAP = Number(process.argv[3] || 20000);

async function probe() {
  const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const p = list.find((t) => t.type === "page" && (t.url || "").includes("win=hud"));
  if (!p) return "no hud target";
  const ws = new WebSocket(p.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  const out = await new Promise((res) => {
    ws.addEventListener("message", (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === 1) res(m.result);
    });
    ws.send(
      JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `JSON.stringify({rs: document.readyState, kids: document.getElementById('root')?.children.length ?? -1, res: performance.getEntriesByType('resource').length, shell: !!document.querySelector('[data-hud-shell]'), cards: document.querySelectorAll('[data-composer-card]').length, text: (document.body.innerText||'').replace(/\\s+/g,' ').slice(0,90), title: document.title})`,
          returnByValue: true,
        },
      }),
    );
  });
  ws.close();
  return out?.result?.value;
}

for (let i = 0; i < COUNT; i++) {
  await wait(GAP);
  console.log(`poll ${i + 1}: ${await probe()}`);
}
