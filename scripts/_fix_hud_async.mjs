// _fix_hud_async.mjs - ensure hud_open/hud_close are async commands (sync = main-thread deadlock)
import fs from "node:fs";
const p = "src-tauri/src/lib.rs";
let t = fs.readFileSync(p, "utf8");
const lines = t.split("\n");
for (const [i, l] of lines.entries()) {
  if (l.includes("fn hud_open") || l.includes("fn hud_close")) console.log(`before ${i + 1}: ${JSON.stringify(l)}`);
}
let n = 0;
for (const name of ["hud_open", "hud_close"]) {
  const from = `\nfn ${name}(app: tauri::AppHandle) -> Result<(), String> {`;
  const to = `\nasync fn ${name}(app: tauri::AppHandle) -> Result<(), String> {`;
  if (t.includes(from)) {
    t = t.replace(from, to);
    n += 1;
  }
}
fs.writeFileSync(p, t, "utf8");
console.log(`converted: ${n}`);
for (const [i, l] of t.split("\n").entries()) {
  if (l.includes("fn hud_open") || l.includes("fn hud_close")) console.log(`after  ${i + 1}: ${JSON.stringify(l)}`);
}
