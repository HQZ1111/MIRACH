// 验证：mint cookie（同 vite-auth-helper 算法）→ 打引擎 /api 探测鉴权
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const credFile = join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".mirach"), ".credentials.yaml");
const src = readFileSync(credFile, "utf8");
const m = src.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([^\s]+)/);
const secret = m ? Buffer.from(m[1], "base64url") : null;
console.log("[diag] secret bytes:", secret?.length ?? 0);

const coreUrl = "http://127.0.0.1:3212";
const authority = new URL(coreUrl).host;
const name = "dsh-auth-" + createHash("sha256").update(authority).digest("base64url");
const now = Date.now();
const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 30 * 24 * 3600 * 1000 };
const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
const sig = createHmac("sha256", secret).update(body).digest().toString("base64url");
const cookie = `${name}=v1.${body}.${sig}`;
console.log("[diag] cookie:", cookie.slice(0, 60) + "...");

for (const path of ["/api/remote.mux", "/api/rpc", "/api/"]) {
  try {
    const r = await fetch(coreUrl + path, {
      headers: { Cookie: cookie, Origin: coreUrl },
    });
    console.log(`[diag] GET ${path} => ${r.status}`);
  } catch (e) {
    console.log(`[diag] GET ${path} => ERR ${e}`);
  }
}
// 无 cookie 对照
const r0 = await fetch(coreUrl + "/api/remote.mux", { headers: { Origin: coreUrl } });
console.log("[diag] no-cookie /api/remote.mux =>", r0.status);
