const fs = require("fs");
const p = "G:/deepseek-harness-master/packages/subagent/subagent-codex";
console.log("== workspace package.json ==");
console.log(fs.readFileSync(p + "/package.json", "utf8"));
console.log("== workspace cordis.patch.yml ==");
console.log(fs.readFileSync(p + "/cordis.patch.yml", "utf8"));
// npm rc.1 的 bin/ 与依赖
const n = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules/@deepseek-ai/dsh-subagent-codex";
const pkg = JSON.parse(fs.readFileSync(n + "/package.json", "utf8"));
console.log("== npm rc.1 bin/deps ==");
console.log(JSON.stringify({ bin: pkg.bin, dependencies: pkg.dependencies, files: pkg.files }, null, 1));
if (fs.existsSync(n + "/bin")) console.log("bin dir:", fs.readdirSync(n + "/bin").join(", "));
