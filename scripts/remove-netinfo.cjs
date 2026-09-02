const fs = require("fs");
const p = "G:/deepseek-harness-master/apps/mirach/agent-sidecar/src/plugins.ts";
let lines = fs.readFileSync(p, "utf8").split("\n");
// 删 1 基 297..351：NetAccessIface/NetAccessInfo 接口 + classifyIface + checkReachable + netAccessInfo
lines.splice(296, 351 - 297 + 1);
fs.writeFileSync(p, lines.join("\n"));
console.log("removed; new total:", lines.length);
