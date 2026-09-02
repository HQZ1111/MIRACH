const fs = require("fs");
const { execSync } = require("child_process");
// 1) subagent-acp apply 的可执行校验与失败模式
const t = fs.readFileSync("G:/deepseek-harness-master/packages/subagent/subagent-acp/src/index.ts", "utf8");
const i = t.indexOf("export function apply");
console.log("== apply ==");
console.log(t.slice(i, i + 1800));
// 2) 谁引用/挂载 subagent-acp（bundle/base? web-app? docs?）
try {
  const hits = execSync('git grep -l "subagent-acp" -- packages/bundle packages/settings docs .agents 2>&1', { cwd: "G:/deepseek-harness-master", encoding: "utf8", maxBuffer: 1024 * 1024 });
  console.log("== 引用位置 ==\n" + hits.trim());
} catch (e) { console.log("== 引用位置 == 无（或 grep 失败）"); }
