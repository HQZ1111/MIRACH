const fs = require("fs");
const p = "G:/deepseek-harness-master/apps/mirach/src/components/overlays/SettingsOverlay.tsx";
let lines = fs.readFileSync(p, "utf8").split("\n");
// 删 1 基 2013..末尾（主组件 SettingsOverlay + 注释）
lines = lines.slice(0, 2012);
fs.writeFileSync(p, lines.join("\n"));
console.log("truncated; new total:", lines.length);
