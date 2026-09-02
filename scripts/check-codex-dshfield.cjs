const fs = require("fs");
const p = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules/@deepseek-ai/dsh-subagent-codex/package.json";
const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
console.log(JSON.stringify({ version: pkg.version, dsh: pkg.dsh ?? null }, null, 1));
