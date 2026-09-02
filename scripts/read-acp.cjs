const fs = require("fs");
const p = "G:/deepseek-harness-master/packages/subagent/subagent-acp";
for (const f of ["README.md", "README.zh.md"]) {
  if (fs.existsSync(p + "/" + f)) { console.log("== " + f + " =="); console.log(fs.readFileSync(p + "/" + f, "utf8").slice(0, 3000)); break; }
}
const idx = fs.readFileSync(p + "/src/index.ts", "utf8");
console.log("== index.ts head ==");
console.log(idx.slice(0, 2200));
