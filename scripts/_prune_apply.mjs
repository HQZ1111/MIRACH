// _prune_apply.mjs - deterministic prune of a runtime tree by category (node, no PS pitfalls)
// usage:
//   node scripts/_prune_apply.mjs --root=<dir> --categories=maps,pdb,tsbuildinfo,testdocs,foreign
//   node scripts/_prune_apply.mjs --root=<dir> --categories=md
import fs from "node:fs";
import path from "node:path";

const args = new Map(
  process.argv.slice(2).map((a) => {
    const i = a.indexOf("=");
    return i === -1 ? [a.replace(/^--/, ""), "true"] : [a.slice(2, i), a.slice(i + 1)];
  }),
);
const root = args.get("root");
const cats = (args.get("categories") ?? "").split(",").filter(Boolean);
if (!root || cats.length === 0) {
  console.error("usage: --root=<dir> --categories=a,b,c");
  process.exit(2);
}
const nm = path.join(root, "agent-sidecar", "node_modules");
if (!fs.existsSync(nm)) {
  console.error("node_modules not found:", nm);
  process.exit(1);
}

const stats = { files: 0, dirs: 0, bytes: 0 };
function rmFile(p, size) {
  try {
    fs.rmSync(p, { force: true });
    stats.files += 1;
    stats.bytes += size;
  } catch {
    /* ignore */
  }
}
function rmDir(p) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const q = path.join(d, e.name);
      if (e.isDirectory()) walk(q);
      else if (e.isFile()) {
        try {
          bytes += fs.statSync(q).size;
          files += 1;
        } catch {
          /* ignore */
        }
      }
    }
  };
  try {
    walk(p);
    fs.rmSync(p, { recursive: true, force: true });
    stats.dirs += 1;
    stats.files += files;
    stats.bytes += bytes;
  } catch {
    /* ignore */
  }
}

function walkDirs(dir, onFile, onDir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (onDir(p, e.name) === "stop") continue;
      walkDirs(p, onFile, onDir);
    } else if (e.isFile()) {
      onFile(p, e.name);
    }
  }
}

const TESTDIRS = new Set(["test", "tests", "__tests__", "spec", "docs", "examples", "example"]);
const wantMaps = cats.includes("maps");
const wantPdb = cats.includes("pdb");
const wantTs = cats.includes("tsbuildinfo");
const wantTests = cats.includes("testdocs");
const wantMd = cats.includes("md");
const wantForeign = cats.includes("foreign");
const wantImgForeign = cats.includes("imgforeign");
const wantPtyForeign = cats.includes("ptyforeign");

walkDirs(
  nm,
  (p, name) => {
    const ext = path.extname(name).toLowerCase();
    let size = 0;
    try {
      size = fs.statSync(p).size;
    } catch {
      return;
    }
    if (wantMaps && ext === ".map") return rmFile(p, size);
    if (wantPdb && ext === ".pdb") return rmFile(p, size);
    if (wantTs && (ext === ".tsbuildinfo" || ext === ".markdown")) return rmFile(p, size);
    if (wantMd && ext === ".md") return rmFile(p, size);
  },
  (p, name) => {
    if (wantTests && TESTDIRS.has(name)) {
      rmDir(p);
      return "stop";
    }
    if (wantForeign || wantImgForeign) {
      const rel = p.slice(nm.length + 1).replace(/\\/g, "/");
      if (/^@img\//.test(rel) && !rel.includes("win32-x64")) {
        rmDir(p);
        return "stop";
      }
    }
    if (wantForeign || wantPtyForeign) {
      const rel = p.slice(nm.length + 1).replace(/\\/g, "/");
      if (/^node-pty\/prebuilds\//.test(rel) && !rel.includes("win32-x64")) {
        rmDir(p);
        return "stop";
      }
    }
    return undefined;
  },
);

console.log(
  `pruned [${cats.join(",")}]: ${stats.files} files, ${stats.dirs} dirs, ${(stats.bytes / 1048576).toFixed(1)} MB`,
);
