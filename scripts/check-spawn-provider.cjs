const fs = require("fs");
const { execSync } = require("child_process");
// 1) spawn 工具的 provider 参数
const t = fs.readFileSync("G:/deepseek-harness-master/packages/subagent/tool-subagent/src/index.ts", "utf8");
const lines = t.split("\n");
lines.forEach((l, i) => {
  if (/provider|backend|acp/i.test(l)) console.log("tool-subagent " + (i + 1) + ": " + l.trim().slice(0, 130));
});
// 2) codex 是否安装
for (const cmd of ["codex --version", "where codex"]) {
  try { console.log("$ " + cmd + " →", execSync(cmd, { encoding: "utf8" }).trim().slice(0, 120)); } catch (e) { console.log("$ " + cmd + " → (不可用)"); }
}
