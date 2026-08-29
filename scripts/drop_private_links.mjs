import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

// drop_private_links.mjs — remove node_modules/@deepseek-ai symlinks from every
// workspace project EXCEPT the engine root, so module resolution falls back to
// the hoisted real copies in <root>/node_modules/@deepseek-ai.
const root = process.argv[2];
if (!root) throw new Error("usage: node drop_private_links.mjs <engineRoot>");

let removed = 0;
const walk = (dir, depth) => {
  if (depth > 4) return;
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules") {
      const ai = join(dir, e.name, "@deepseek-ai");
      if (existsSync(ai)) {
        rmSync(ai, { recursive: true, force: true });
        removed++;
        continue;
      }
      // still recurse into node_modules? no — nothing engine-owned inside
      continue;
    }
    if (e.name.startsWith(".") || e.name === "dist" || e.name === "lib") continue;
    walk(join(dir, e.name), depth + 1);
  }
};
walk(root, 0);
console.log("private @deepseek-ai dirs removed:", removed);