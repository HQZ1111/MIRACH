// Two SettingsPanel .panel nodes? One 16x16 hidden, one 800x800 visible. The 16x16 hidden panel: this may be the OFFICIAL onboarding SettingsRoot instance... The panels: only the visible 800x800 is the dialog. Its overlay contains nav cells.
// Check if the 16x16 panel belongs to a settings root outside kernel mirror (e.g., an onboarding hero trigger). Both SettingsRoot instances: one visible (kernel mirror surfaced). OK single.
// Now the state question — react onClick may not fire because React 19 dispatches from ROOT container: synthetic events attach at the nearest React root container (#root and mirror root?). Our capture runs at document before React root dispatch; but React listens at the container node (root element). Since the event is composed through the DOM path from target up to root, React should catch at its delegated container.
// Directly test whether ANY handler changes state by clicking through REAL WebView input: use cdP Input domain we did; nothing. Next theory: the SettingsRoot visible belongs to the onboarding SHIM (renders SettingsRoot but rows = useSections hook that returns entries EXCLUDING official beyond first?) no—navList shows 16 rows.

// Let's measure if clicking cell 12 with REAL mouse (via Input) actually moves pointer / triggers React by watching a setInterval capture of aria-current over time right after click.
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  return send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  await rawEval(`(() => {
    window.__trace = [];
    const mir = document.querySelector('[data-kernel-mirror]');
    const list = mir.querySelector('[class*="_navList"]');
    // instrument all cell props onClicks
    [...list.querySelectorAll('button')].forEach((b, i) => {
      const k = Object.keys(b).find(x => x.startsWith('__reactProps$'));
      if (k && typeof b[k].onClick === 'function') {
        const orig = b[k].onClick;
        b[k].onClick = function (e) { window.__trace.push('props.onClick i=' + i + ' t=' + (b.textContent||'').trim().slice(0,8)); return orig.call(this, e); };
      }
      b.addEventListener('click', () => window.__trace.push('native i=' + i + ' t=' + (b.textContent||'').trim().slice(0,8)), false);
    });
    // also instrument fiber-level props
    const fb = [...list.querySelectorAll('button')][12];
    const fk = Object.keys(fb).find(x => x.startsWith('__reactFiber$'));
    return 'armed fiber=' + (fk ? 'yes' : 'no') + ' propsOnClick=' + typeof (()=>{const k=Object.keys(fb).find(x=>x.startsWith('__reactProps$'));return k?fb[k].onClick:null})();
  })()`);
  const pt = (await rawEval(`(() => { const m = document.querySelector('[data-kernel-mirror]'); const b=[...m.querySelector('[class*="_navList"]').querySelectorAll('button')][12]; const r=b.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; })()`)).result?.result?.value;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await sleep(80);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1 });
  await sleep(2000);
  console.log("trace:", (await rawEval(`JSON.stringify(window.__trace)`)).result?.result?.value);
  console.log("active:", (await rawEval(`(() => { const m=document.querySelector('[data-kernel-mirror]'); return JSON.stringify([...m.querySelectorAll('[aria-current]')].map(e=>(e.textContent??'').trim())); })()`)).result?.result?.value);
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
