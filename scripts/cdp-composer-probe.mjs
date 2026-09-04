// probe: current composer DOM, model seat contents, whether chatStyle dsh / minimal / default
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function evalJs(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return { threw: r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "").slice(0, 500) };
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // close settings first to see chat view
  await evalJs(`(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); return 1; })()`);
  await sleep(1500);
  console.log("chat:", await evalJs(`(() => {
    const out = {};
    const mir = document.querySelector('[data-kernel-mirror]');
    out.mirrorVisible = mir ? getComputedStyle(mir).opacity : null;
    // mirach composer candidate: textarea near '输入消息'
    const tex = [...document.querySelectorAll('textarea')].map(el => {
      const r = el.getBoundingClientRect();
      return { ph: el.placeholder, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), cls: (el.className ?? '').toString().slice(0, 40) };
    });
    out.textareas = tex.slice(0, 6);
    // model chip visible top-right of input?
    const modelSeat = document.querySelector('.native-model-seat');
    out.modelSeat = modelSeat ? { text: modelSeat.innerText.slice(0, 200), html: modelSeat.innerHTML.slice(0, 300) } : null;
    // any official composer card?
    const card = document.querySelector('[data-composer-card]');
    out.officialCard = card ? { text: card.innerText.slice(0, 160), html: card.innerHTML.slice(0, 240) } : null;
    // mirach composer root classes (tools row icons)
    const plusBtns = [...document.querySelectorAll('button')].filter(b => (b.textContent ?? '').trim().length === 0 && ((b.querySelector('svg')?.innerHTML ?? '') || '').length > 0).slice(0, 12).map(b => {
      const r = b.getBoundingClientRect();
      const svg = b.querySelector('svg');
      return { aria: b.getAttribute('aria-label'), title: b.getAttribute('title'), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), svgClass: (svg?.getAttribute('class') ?? '').slice(0, 30) };
    });
    out.iconButtons = plusBtns;
    return JSON.stringify(out);
  })()`));
  // model catalog via fetch with auth cookie (vite proxy)
  console.log("catalog:", await evalJs(`(async () => {
    try {
      const r = await fetch("/api/session/modelCatalog");
      if (!r.ok) return "HTTP " + r.status;
      const j = await r.json();
      const groups = (j.data?.groups ?? j.groups ?? []).map(g => ({ provider: g.provider, label: g.label ?? g.provider, models: (g.models ?? []).map(m => m.model ?? m.id ?? m.name).slice(0, 12) }));
      return JSON.stringify({ groups: groups.slice(0, 8), failures: (j.data?.failures ?? j.failures ?? j.data?.errors ?? j.failures ?? []).slice(0, 4) });
    } catch (e) { return "ERR " + e.message; }
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 90000);
