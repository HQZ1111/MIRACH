// _hud_css_rename.mjs — 把 hud-styles.css 里 hermes 的 [data-slot='X'] 改名成 [data-hud-slot='X']
// （X 是 hermes 自己的 slot 名；官方 DOM 上没有它们，改由 hud-slots.ts 打标签）
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/components/hud/hud-styles.css";
const src = readFileSync(FILE, "utf8");
const before = (src.match(/\[data-slot='/g) ?? []).length;
const out = src.replace(/\[data-slot='([^']+)'\]/g, "[data-hud-slot='$1']");
const after = (out.match(/\[data-hud-slot='/g) ?? []).length;
const left = (out.match(/\[data-slot='/g) ?? []).length;
writeFileSync(FILE, out, "utf8");
console.log(`renamed: ${before} -> ${after} (data-hud-slot), 残留 data-slot: ${left}`);
