// _hud_port_diff.mjs — mirach 的 HUD 与 hermes 的 HUD 逐行相似度（回答"是不是整套拿过来的"）
import { readFileSync } from "node:fs";

const HERMES = "D:/hermes-agent-main/apps/desktop/src";
const MIRACH = "G:/deepseek-harness-master/apps/mirach/src/components/hud";

const PAIRS = [
  ["app/hud/hud-shell.tsx", "HudShell.tsx"],
  ["app/hud/click-through.ts", "click-through.ts"],
  ["app/hud/composer-drag.ts", "composer-drag.ts"],
  ["app/hud/glass.ts", "glass.ts"],
  ["app/hud/layout.ts", "layout.ts"],
  ["app/hud/resize-handle.ts", "resize-handle.ts"],
  ["app/hud/thread-focus.ts", "thread-focus.ts"],
  ["app/hud/transcript-band.ts", "transcript-band.ts"],
];

const lines = (p) =>
  readFileSync(p, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

const norm = (l) => l.replace(/\s+/g, " ");

console.log("file".padEnd(26) + "hermes  mirach  逐字相同  覆盖率");
for (const [h, m] of PAIRS) {
  let a, b;
  try {
    a = lines(`${HERMES}/${h}`);
    b = lines(`${MIRACH}/${m}`);
  } catch (e) {
    console.log(`${h} -> 读取失败 ${e.message}`);
    continue;
  }
  const setB = new Set(b.map(norm));
  const same = a.filter((l) => setB.has(norm(l))).length;
  console.log(
    `${h.split("/").pop().padEnd(26)}${String(a.length).padStart(6)}${String(b.length).padStart(7)}${String(same).padStart(9)}${((same / a.length) * 100).toFixed(0).padStart(8)}%`,
  );
}

// HUD CSS：hermes 的 styles.css（从第一条 [data-hud-shell] 规则到文件末尾）vs mirach 的 hud-styles.css
const hs = readFileSync(`${HERMES}/styles.css`, "utf8");
const hudBlock = hs.slice(hs.indexOf("[data-hud-shell]"));
const a = hudBlock.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("/*"));
const b = lines(`${MIRACH}/hud-styles.css`).filter((l) => !l.startsWith("/*"));
const setB = new Set(b.map(norm));
const same = a.filter((l) => setB.has(norm(l))).length;
console.log(
  `\nHUD CSS（hermes styles.css 的 [data-hud-shell] 段）: ${a.length} 行非空，其中 ${same} 行（${((same / a.length) * 100).toFixed(0)}%）在 mirach 的 hud-styles.css 里逐字存在`,
);

// slot 词表对照
const slots = (t) => new Set([...t.matchAll(/\[data-slot='([^']+)'\]/g)].map((m) => m[1]));
const hermesSlots = slots(hudBlock);
const mirachSlots = slots(readFileSync(`${MIRACH}/hud-styles.css`, "utf8"));
const onlyHermes = [...hermesSlots].filter((s) => !mirachSlots.has(s));
console.log(`\nhermes HUD CSS 用的 slot：${[...hermesSlots].join(", ")}`);
console.log(`mirach hud-styles.css 独有：${[...mirachSlots].filter((s) => !hermesSlots.has(s)).join(", ") || "(无)"}`);
console.log(`hermes 有、mirach 没有的：${onlyHermes.join(", ") || "(无)"}`);
