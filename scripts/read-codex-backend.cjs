const fs = require("fs");
const p = "G:/deepseek-harness-master/packages/subagent/subagent-codex";
if (!fs.existsSync(p)) { console.log("not in tree:", p); process.exit(0); }
function walk(dir, depth) {
  if (depth > 2) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const pp = dir + "/" + e.name;
    if (e.isDirectory()) { if (["node_modules", "dist", "lib", "tests"].includes(e.name)) continue; console.log(pp.replace(/G:\/deepseek-harness-master\//, "") + "/"); walk(pp, depth + 1); }
    else console.log(pp.replace(/G:\/deepseek-harness-master\//, ""));
  }
}
walk(p, 0);
const r = p + "/README.md";
if (fs.existsSync(r)) { console.log("== README =="); console.log(fs.readFileSync(r, "utf8").slice(0, 3500)); }
