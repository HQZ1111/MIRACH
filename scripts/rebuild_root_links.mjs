import { readFileSync, existsSync, readdirSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join } from "node:path";

// rebuild_root_links.mjs — junction every @deepseek-ai/* workspace package into
// <engineRoot>/node_modules/@deepseek-ai (pnpm --prod omits workspace pkgs there,
// but prebuilt lib/ products still import them at runtime; tsx handles TS sources).
const root = process.argv[2];
if (!root) throw new Error("usage: node rebuild_root_links.mjs <engineRoot>");

const nameToDir = new Map();
const scan = (dir, depth) => {
  if (depth > 4) return;
  const pj = join(dir, "package.json");
  if (existsSync(pj)) {
    try {
      const pkg = JSON.parse(readFileSync(pj, "utf8"));
      if (pkg.name?.startsWith("@deepseek-ai/") && !nameToDir.has(pkg.name)) nameToDir.set(pkg.name, dir);
    } catch {}
  }
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "dist" || e.name === "lib") continue;
    scan(join(dir, e.name), depth + 1);
  }
};
scan(root, 0);

const scope = join(root, "node_modules", "@deepseek-ai");
mkdirSync(scope, { recursive: true });
let created = 0, present = 0;
for (const [name, dir] of nameToDir) {
  const linkPath = join(scope, name.split("/")[1]);
  let exists = false;
  try { exists = statSync(linkPath).isDirectory(); } catch {}
  if (exists) { present++; continue; }
  try {
    symlinkSync(dir, linkPath, "junction");
    created++;
  } catch (e) {
    console.log("link failed:", name, e.message);
  }
}
console.log(`workspace scope: total=${nameToDir.size} present=${present} created=${created}`);