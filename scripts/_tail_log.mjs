// _tail_log.mjs - print ready-count and last lines of a log
import fs from "node:fs";
const f = process.argv[2] ?? "scripts/_tauri_dev22.log";
const L = fs.readFileSync(f, "utf8").split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, "").trim());
const ready = L.filter((l) => /runtime ready/.test(l)).length;
const hud = L.filter((l) => /hud/i.test(l)).length;
console.log(`file=${f} lines=${L.length} runtime_ready_lines=${ready} hud_lines=${hud}`);
console.log(L.slice(-6).join("\n"));
