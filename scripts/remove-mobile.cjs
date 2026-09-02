const fs = require("fs");
const p = "G:/deepseek-harness-master/apps/mirach/src/components/overlays/SettingsOverlay.tsx";
let lines = fs.readFileSync(p, "utf8").split("\n");
// 行号（1 基）：76 = SECTIONS mobile 行；2100 = case "mobile"；2327-2538 = MobileAccessSection
// 从后往前删，避免行号漂移
lines.splice(2326, 2538 - 2326 + 1); // 删 2327..2538
lines.splice(2099, 1); // 删 2100
lines.splice(75, 1); // 删 76
fs.writeFileSync(p, lines.join("\n"));
console.log("removed; new total lines:", lines.length);
