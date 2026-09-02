const fs = require("fs");
const p = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules/@deepseek-ai/dsh-subagent-codex";
console.log("== installed files ==");
function walk(d, depth) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const pp = d + "/" + e.name;
    if (e.isDirectory()) { console.log(pp.replace(p, "") + "/"); walk(pp, depth + 1); }
    else console.log(pp.replace(p, "") + "  (" + fs.statSync(pp).size + "B)");
  }
}
walk(p, 0);
const run = fs.readFileSync(p + "/lib/run.js", "utf8");
// 找它怎么定位 codex 可执行
const lines = run.split("\n");
lines.forEach((l, i) => {
  if (/codex|platform|win32|vendor|bin|require\.resolve|@openai/i.test(l) && !/^\s*\*/.test(l)) {
    console.log("run.js " + (i + 1) + ": " + l.trim().slice(0, 140));
  }
});
