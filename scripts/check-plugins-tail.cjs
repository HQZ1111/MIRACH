const fs = require("fs");
const t = fs.readFileSync("G:/deepseek-harness-master/apps/mirach/agent-sidecar/src/plugins.ts", "utf8");
const lines = t.split("\n");
lines.forEach((l, i) => {
  if (/netAccessInfo|NetAccess|classifyIface|checkReachable|networkInterfaces|import \bnet\b|from "node:net"|require\("node:net"\)/.test(l)) {
    console.log(i + 1 + ": " + l.trim().slice(0, 110));
  }
});
console.log("--- tail 20 ---");
console.log(lines.slice(-12).join("\n"));
