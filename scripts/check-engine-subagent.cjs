const fs = require("fs");
const path = require("path");
// 引擎全局安装里的 dsh-base / web-app 装配，找 subagent 工具注册
const g = "C:/Users/Administrator/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai";
const hits = [];
function grep(dir, needle, depth) {
  if (depth > 3) return;
  let es;
  try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules"].includes(e.name) && depth > 0) continue;
      grep(p, needle, depth + 1);
      continue;
    }
    if (!/\.ya?ml$|\.json$/.test(e.name)) continue;
    let t;
    try { t = fs.readFileSync(p, "utf8"); } catch { continue; }
    if (t.includes(needle)) hits.push(p.replace(g, "") + " → " + needle);
  }
}
// 只看顶层包名
console.log("engine deps:", fs.readdirSync(g).filter((n) => /subagent|base|web-app/.test(n)).join(" "));
// dsh-base 的 cordis 装配
const base = path.join(g, "dsh-base");
if (fs.existsSync(base)) {
  grep(base, "subagent", 0);
  console.log("---");
  const yl = path.join(base, "cordis.yml");
  if (fs.existsSync(yl)) console.log(fs.readFileSync(yl, "utf8").slice(0, 1500));
}
