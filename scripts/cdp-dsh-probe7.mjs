// dsh-probe7: geometry of the INLINE official tree (visible?) + composer card/hooks + input.left/right slot elements
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) return "ERR " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 400);
  return r.result?.result?.value;
}
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const h = pending.get(m.id); pending.delete(m.id); h.resolve(m); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  console.log(await rawEval(`(() => {
    const out = {};
    const convs = [...document.querySelectorAll('[data-slot="conversation"]')].filter(c => !c.closest('[data-kernel-mirror]'));
    if (convs.length === 0) return 'no inline conv';
    const conv = convs[0];
    // walk up to the NativeChatArea wrapper (has DSW alias style) and down to the AppFrame grid
    let host = conv.parentElement;
    const chain = [];
    while (host && chain.length < 6) { const r = host.getBoundingClientRect(); chain.push([host.tagName, Math.round(r.width), Math.round(r.height)]); host = host.parentElement; }
    out.ancestorSizes = chain;
    const frame = conv.closest('[class*="frame"], [style*="grid-template-columns"]');
    if (frame) { const r = frame.getBoundingClientRect(); out.frameRect = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; }
    // composer card
    const card = conv.querySelector('[data-composer-card]');
    if (card) {
      const r = card.getBoundingClientRect();
      out.composerCard = { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], cls: (card.className||'').toString().slice(0, 60), bg: getComputedStyle(card).backgroundColor, radius: getComputedStyle(card).borderRadius };
    }
    // input.left / input.right slot hosts
    for (const k of ['conversation.input.left', 'conversation.input.right', 'conversation.input.model']) {
      const el = conv.querySelector('[data-slot="' + k + '"]');
      if (el) {
        const r = el.getBoundingClientRect();
        out[k] = { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], parentCls: (el.parentElement?.className||'').toString().slice(0,50) };
      } else out[k] = null;
    }
    return JSON.stringify(out).slice(0, 2500);
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
