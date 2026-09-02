const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const nm = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules";
const target = nm + "/@openai/codex-win32-x64";
if (fs.existsSync(target)) { console.log("payload already present"); process.exit(0); }
const tmp = "G:/deepseek-harness-master/apps/mirach/scripts/_codex-payload";
fs.mkdirSync(tmp, { recursive: true });
let ok = false;
for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
  try {
    console.log("npm pack attempt", attempt);
    execSync("npm pack @openai/codex@0.149.1-win32-x64 --pack-destination " + JSON.stringify(tmp), { encoding: "utf8", timeout: 300000, stdio: "inherit" });
    ok = true;
  } catch (e) { console.log("attempt failed:", (e.stderr || e.message || "").slice(0, 150)); }
}
if (!ok) { console.log("all attempts failed — network to npm for this tarball keeps resetting"); process.exit(1); }
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith(".tgz"));
execSync("tar -xzf " + JSON.stringify(tmp + "/" + tgz) + " -C " + JSON.stringify(tmp));
fs.mkdirSync(target, { recursive: true });
fs.cpSync(tmp + "/package", target, { recursive: true });
fs.rmSync(tmp, { recursive: true, force: true });
console.log("payload installed at", target);
console.log("files:", fs.readdirSync(target).join(", "));
