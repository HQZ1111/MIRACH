const { execSync } = require("child_process");
const fs = require("fs");
const opt = { cwd: "G:/deepseek-harness-master/apps/mirach", encoding: "utf8", maxBuffer: 512 * 1024 * 1024 };
const old = execSync("git show 4674536:src/components/overlays/SettingsOverlay.tsx", opt).toString();
const oldLines = old.split("\n");
const start = oldLines.findIndex((l) => l.replace(/\r$/, "").startsWith("function MemorySection"));
if (start < 0) { console.log("still not found"); process.exit(1); }
let end = start;
for (let i = start + 1; i < oldLines.length; i++) {
  if (oldLines[i].replace(/\r$/, "") === "}") { end = i; break; }
}
const block = oldLines.slice(start, end + 1).map((l) => l.replace(/\r$/, ""));
const p = "G:/deepseek-harness-master/apps/mirach/src/components/overlays/SettingsOverlay.tsx";
let lines = fs.readFileSync(p, "utf8").split("\n");
// 去掉上次误追加的空行尾巴
while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
lines = lines.concat([""], block);
fs.writeFileSync(p, lines.join("\n"));
console.log("MemorySection restored:", block.length, "lines; block head:", block[0]);
