// _probe_mic.mjs - one-shot CDP probe: mic permission + AudioWorklet + echo cancellation
// usage: node scripts/_probe_mic.mjs [port]
const PORT = Number(process.argv[2] ?? 9222);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getPageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up */
    }
    await sleep(1000);
  }
  throw new Error(`no CDP page on :${PORT}`);
}

const ws = new WebSocket(await getPageWs());
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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
await new Promise((res, rej) => {
  ws.addEventListener("open", res, { once: true });
  ws.addEventListener("error", rej, { once: true });
});
await send("Runtime.enable");

const expression = String.raw`(async () => {
  const r = { url: location.href, origin: location.origin, secure: window.isSecureContext };
  r.hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  if (r.hasGetUserMedia) {
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error("PENDING >10s — a permission prompt may be waiting")), 10000)),
      ]);
      const t = stream.getAudioTracks()[0];
      const s = t.getSettings();
      r.mic = "granted";
      r.track = { label: t.label, muted: t.muted };
      r.settings = {
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
        sampleRate: s.sampleRate,
        channelCount: s.channelCount,
      };
      stream.getTracks().forEach((x) => x.stop());
    } catch (e) {
      r.mic = "failed";
      r.micError = e && e.name ? e.name + ": " + e.message : String(e);
    }
  }
  try {
    const src = 'class P extends AudioWorkletProcessor { process() { return true } } registerProcessor("p", P)';
    const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(url);
    r.worklet = "ok";
    r.audioContextState = ctx.state;
    await ctx.close();
  } catch (e) {
    r.worklet = "failed: " + String(e);
  }
  return JSON.stringify(r, null, 1);
})()`;

const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
if (res.exceptionDetails) {
  console.error("probe threw:", JSON.stringify(res.exceptionDetails).slice(0, 600));
  process.exit(1);
}
console.log(typeof res.result?.value === "string" ? res.result.value : JSON.stringify(res.result));
ws.close();
