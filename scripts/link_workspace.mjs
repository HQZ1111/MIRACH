import { readFileSync, existsSync, readdirSync, mkdirSync, symlinkSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// link_workspace.mjs — re-create junctions for @deepseek-ai/* workspace packages
// inside each workspace project's node_modules (pnpm --prod skips devDeps links,
// but prebuilt lib/ products still require them at runtime).
const root = process.argv[2] ?? ".";
const abs = (p) => join(root, p);

// 1) collect workspace packages: name -> dir
const nameToDir = new Map();
const scan = (dir, depth) => {
  if (depth > 4) return;
  const pj = join(dir, "package.json");
  if (existsSync(pj)) {
    try {
      const pkg = JSON.parse(readFileSync(pj, "utf8"));
      if (pkg.name && !nameToDir.has(pkg.name)) nameToDir.set(pkg.name, dir);
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
scan(abs(""), 0);
console.log("workspace packages:", nameToDir.size);

// 2) for each package, ensure node_modules links for its workspace deps
let created = 0, missing = [];
for (const [name, dir] of nameToDir) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")); } catch { continue; }
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}), ...(pkg.peerDependencies ?? {}) };
  const nm = join(dir, "node_modules");
  for (const dep of Object.keys(deps)) {
    if (!dep.startsWith("@deepseek-ai/")) continue;
    const target = nameToDir.get(dep);
    if (!target) { missing.push(name + " -> " + dep); continue; }
    const linkPath = join(nm, dep);
    let exists = false;
    try { exists = statSync(linkPath).isDirectory(); } catch {}
    if (exists) continue;
    try {
      mkdirSync(nm, { recursive: true });
      symlinkSync(target, linkPath, "junction");
      created++;
    } catch (e) {
      console.log("link failed:", relative(root, linkPath), e.message);
    }
  }
}
console.log("links created:", created);
if (missing.length) console.log("unresolved deps:\n  " + missing.join("\n  "));