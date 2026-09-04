// seat menu open. Click 模型 drill then dump full model list incl ds custom group
const WS = process.argv[2];
const ws = new WebSocket(WS);
let seq = 0;
const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
}
async function rawEval(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value ?? "ERR";
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id).resolve(m); pending.delete(m.id); }
};
ws.onopen = async () => {
  await send("Runtime.enable");
  // click root 模型 row (menu item text starts 模型)
  console.log(await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat');
    const rows = [...seat.querySelectorAll('[role="menuitem"], button')];
    const modelRow = rows.find(b => (b.textContent ?? '').trim().startsWith('模型'));
    if (modelRow) { modelRow.click(); return 'clicked 模型'; }
    return 'no row; texts=' + JSON.stringify(rows.map(b => (b.textContent ?? '').trim().slice(0, 20)).slice(0, 10));
  })()`));
  await sleep(1000);
  console.log("drill:", await rawEval(`(() => {
    const seat = document.querySelector('.native-model-seat');
    const menutext = seat ? seat.innerText.slice(0, 1200) : '(no seat)';
    const groups = seat ? [...seat.querySelectorAll('[class*="_group"], [role="group"]')].map(g => g.innerText.slice(0, 120)) : [];
    return JSON.stringify({ text: menutext, groups });
  })()`));
  process.exit(0);
};
setTimeout(() => { console.error("timeout"); process.exit(3); }, 60000);
