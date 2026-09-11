// _hud_fix_position.mjs — 把 HUD 里 bar/band 的绝对定位改成相对窗口视口的 fixed
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/components/hud/hud-styles.css";
let src = readFileSync(FILE, "utf8");
const dockMark = "[data-hud-shell] [data-hud-slot~='composer-dock'] {";
const bandMark = "[data-hud-shell] [data-hud-slot~='composer-bounds'] {";

for (const mark of [dockMark, bandMark]) {
  const start = src.lastIndexOf(mark);
  if (start < 0) {
    console.log(`mark not found: ${mark}`);
    continue;
  }
  const end = src.indexOf("}", start);
  const block = src.slice(start, end);
  const fixed = block.replace("position: absolute !important;", "position: fixed !important;");
  if (fixed === block) {
    console.log(`${mark}: no absolute found in block`);
    continue;
  }
  src = src.slice(0, start) + fixed + src.slice(end);
  console.log(`${mark}: absolute -> fixed`);
}

src =
  src.trimEnd() +
  "\n\n/* bar 与 band 都相对**窗口视口**定位（position: fixed）：官方那条列里，bar 的盒子会跟着\n   某个滚动祖先位移（实测卡片被推到 y=-306，条子等于看不见）。HUD 的契约本来就是\n   \"bar 钉在窗口顶、transcript 挂在它下面\"，与列内滚动无关。 */\n";
writeFileSync(FILE, src, "utf8");
console.log("done");
