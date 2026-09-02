const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cred = fs.readFileSync(path.join(os.homedir(), ".mirach", ".credentials.yaml"), "utf8");
const m = cred.match(/secret:\s*"?([A-Za-z0-9+/=_-]+)"?/);
const secret = m[1];
const ts = Date.now().toString();
const sig = crypto.createHmac("sha256", secret).update(ts).digest("hex");
const cookie = "dsh-auth=" + ts + "." + sig;
fetch("http://127.0.0.1:3212/dsh-pocket/pocket.status", {
  method: "POST",
  headers: { "content-type": "application/json", cookie, origin: "http://127.0.0.1:3212" },
  body: JSON.stringify({ type: "client-request", rpcId: "1", method: "pocket.status", payload: { args: {} } }),
}).then(async (r) => {
  console.log("status", r.status);
  console.log((await r.text()).slice(0, 400));
}).catch((e) => console.log("ERR", e.message));
