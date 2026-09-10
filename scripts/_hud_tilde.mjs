// _hud_tilde.mjs — 把 HUD 侧对 hermes slot 名的选择器改成"列表包含"匹配（~=）
// 原因：官方结构里一个元素可能同时是好几个 hermes 名（band=视口、dock=bar 外层），
// data-hud-slot 是空格分隔列表 → 必须用 [attr~='name']，等号匹配会漏。
import { readFileSync, writeFileSync } from "node:fs";

const FILES = [
  "src/components/hud/hud-styles.css",
  "src/components/hud/click-through.ts",
  "src/components/hud/glass.ts",
  "src/components/hud/transcript-band.ts",
];

for (const f of FILES) {
  const src = readFileSync(f, "utf8");
  // [data-hud-slot='x'] / [data-hud-slot="x"] → [data-hud-slot~='x']
  const out = src
    .replace(/\[data-hud-slot='([^']+)'\]/g, "[data-hud-slot~='$1']")
    .replace(/\[data-hud-slot="([^"]+)"/g, '[data-hud-slot~="$1"');
  const n = (src.match(/data-hud-slot=/g) ?? []).length;
  writeFileSync(f, out, "utf8");
  console.log(`${f}: ${n} 处选择器`);
}
