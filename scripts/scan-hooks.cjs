const fs = require("fs");
const path = require("path");
const root = "G:/deepseek-harness-master/packages/hooks";
console.log("== hooks 目录 ==");
function walk(dir, depth) {
  if (depth > 3) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isDirectory()) { if (["node_modules", "dist", "lib"].includes(e.name)) continue; console.log(p.replace(/G:\/deepseek-harness-master\//, "") + "/"); walk(p, depth + 1); }
    else console.log(p.replace(/G:\/deepseek-harness-master\//, ""));
  }
}
walk(root, 0);
const readme = root + "/README.md";
if (fs.existsSync(readme)) { console.log("== README =="); console.log(fs.readFileSync(readme, "utf8").slice(0, 2500)); }
