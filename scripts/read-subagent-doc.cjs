const fs = require("fs");
const t = fs.readFileSync("G:/deepseek-harness-master/docs/subsystems/subagent.md", "utf8");
const i = t.toLowerCase().indexOf("acp");
console.log(t.slice(Math.max(0, i - 500), i + 2500));
