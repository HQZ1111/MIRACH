const fs = require("fs");
// packages/README.md 里 codex 的上下文（可能就是“把外部 agent 接成子代理”的说明）
const t = fs.readFileSync("G:/deepseek-harness-master/packages/README.md", "utf8");
const i = t.toLowerCase().indexOf("codex");
console.log(t.slice(Math.max(0, i - 1500), i + 500));
