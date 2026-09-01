// 验证：mint cookie 后 POST /api/rpc + WS 升级
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const credFile = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".mirach"), ".credentials.yaml");
const src = readFileSync(credFile, "utf8");
const m = src.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([^\s]+)/);
const secret = m ? Buffer.from(m[1], "base64url") : null;
const coreUrl = "http://127.0.0.1:3212";
const authority = new URL(coreUrl).host;
const name = "dsh-auth-" + createHash("sha256").update(authority).digest("base64url");
const now = Date.now();
const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 30 * 24 * 3600 * 1000 };
const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
const cookie = `${name}=v1.${body}.${sig}`;

// POST /api/rpc 带 cookie
try {
  const r = await fetch(coreUrl + "/api/rpc", {
    method: "POST",
    headers: { Cookie: cookie, Origin: coreUrl, "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  });
  console.log("[diag] POST /api/rpc =>", r.status, JSON.stringify(await r.text()).slice(0, 200));
} catch (e) { console.log("[diag] POST /api/rpc ERR", e); }

// WS 升级（模拟浏览器 WebSocket 握手）
try {
  const r = await fetch(coreUrl + "/api/remote.mux", {
    headers: { Cookie: cookie, Origin: coreUrl, Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
  });
  console.log("[diag] WS upgrade =>", r.status);
} catch (e) { console.log("[diag] WS upgrade ERR", e); }
