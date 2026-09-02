const { execSync } = require("child_process");
const fs = require("fs");
const nm = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules";
const target = nm + "/@anthropic-ai/claude-agent-sdk-win32-x64";
if (fs.existsSync(target)) { console.log("payload already present:", fs.readdirSync(target).join(", ")); process.exit(0); }
const tmp = require("node:os").tmpdir() + "/dsh-payload-cc";
fs.mkdirSync(tmp, { recursive: true });
let ok = false;
for (let attempt = 1; attempt <= 6 && !ok; attempt++) {
  try {
    console.log("npm pack attempt", attempt);
    execSync("npm pack @anthropic-ai/claude-agent-sdk-win32-x64@0.3.241 --pack-destination " + JSON.stringify(tmp), { encoding: "utf8", timeout: 600000, stdio: "inherit" });
    ok = true;
  } catch (e) { console.log("attempt failed:", (e.stderr || e.message || "").slice(0, 150)); }
}
if (!ok) { console.log("all attempts failed"); process.exit(1); }
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
execSync("tar -xzf " + JSON.stringify(tmp + "/" + tgz) + " -C " + JSON.stringify(tmp));
fs.mkdirSync(target, { recursive: true });
fs.cpSync(tmp + "/package", target, { recursive: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log("payload installed at", target);
console.log("files:", fs.readdirSync(target).join(", "));

