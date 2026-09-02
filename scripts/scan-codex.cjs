const fs = require("fs");
const path = require("path");
// 1) 全仓搜 codex
const { execSync } = require("child_process");
try {
  const hits = execSync('git grep -il "codex" -- packages apps 2>&1', { cwd: "G:/deepseek-harness-master", encoding: "utf8", maxBuffer: 1024 * 1024 });
  console.log("== codex in upstream tree ==\n" + hits.trim().split("\n").slice(0, 20).join("\n"));
} catch (e) { console.log("codex: no hits in tracked files"); }
// 2) subagent-acp 结构
const d = "G:/deepseek-harness-master/packages/subagent/subagent-acp/src";
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) walk(p);
    else console.log(p.replace(/G:\/deepseek-harness-master\//, ""));
  }
}
console.log("== subagent-acp files ==");
walk(d);
