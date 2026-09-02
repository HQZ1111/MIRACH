const fs = require("fs");
const nm = "C:/Users/Administrator/.mirach/profiles/mirach/node_modules";
console.log("== @openai scope ==");
try { console.log(fs.readdirSync(nm + "/@openai").join(", ")); } catch (e) { console.log("(no @openai)"); }
const codex = nm + "/@openai/codex";
if (fs.existsSync(codex)) {
  const pkg = JSON.parse(fs.readFileSync(codex + "/package.json", "utf8"));
  console.log("codex version:", pkg.version);
  console.log("optionalDependencies:", JSON.stringify(pkg.optionalDependencies ?? null));
  console.log("bin:", JSON.stringify(pkg.bin ?? null));
  // vendor 目录形态（codex 包通常带 vendor/<platform>/codex.exe）
  function walk(d, depth) {
    if (depth > 2) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = d + "/" + e.name;
      if (e.isDirectory()) { console.log(p.replace(nm, "") + "/"); walk(p, depth + 1); }
    }
  }
  walk(codex, 0);
}
