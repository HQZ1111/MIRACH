const fs = require("fs");
const p = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules/@deepseek-ai/dsh-subagent-codex";
const idx = fs.readFileSync(p + "/lib/index.js", "utf8");
// 找 codex 可执行定位逻辑
const lines = idx.split("\n");
lines.forEach((l, i) => {
  if (/codex-win32|@openai\/codex|platform|vendor|bin\/codex|resolve|exe/i.test(l) && !/^\s*(\*|\/\/\s*$)/.test(l)) {
    console.log((i + 1) + ": " + l.trim().slice(0, 150));
  }
});
// 还有 cordis.patch.yml（alpha.4 自带）
console.log("== 自带 cordis.patch.yml ==");
console.log(fs.readFileSync(p + "/cordis.patch.yml", "utf8"));
