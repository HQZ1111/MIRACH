const { coreAuthCookie } = require("G:/deepseek-harness-master/apps/mirach/vite-auth-helper.mjs");
const cookie = coreAuthCookie("http://127.0.0.1:3212");
fetch("http://localhost:1420/dsh-pocket/pocket.status", {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin: "http://localhost:1420" },
  body: JSON.stringify({ type: "client-request", rpcId: "1", method: "pocket.status", payload: { args: {} } }),
}).then(async (r) => {
  console.log("via vite proxy:", r.status);
  console.log((await r.text()).slice(0, 300));
}).catch((e) => console.log("ERR", e.message));
