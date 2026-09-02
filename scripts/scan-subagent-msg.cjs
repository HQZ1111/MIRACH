const fs = require("fs");
const path = require("path");
// 1) 引擎侧 subagent 包里的“消息”能力
const dirs = [
  "G:/deepseek-harness-master/packages/subagent",
  "G:/deepseek-harness-master/packages/client/ui-subagent",
];
const hits = [];
function walk(d, depth) {
  if (depth > 5) return;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) {
      if (["node_modules", "dist", "lib", "tests"].includes(e.name)) continue;
      walk(p, depth + 1);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    let t;
    try { t = fs.readFileSync(p, "utf8"); } catch { continue; }
    const lines = t.split("\n");
    lines.forEach((l, i) => {
      if (/send_message|sendMessage|subagent\.message|message_subagent|parent.*message|message.*parent|inter_agent|agent_message/i.test(l)) {
        hits.push(p.replace(/G:\/deepseek-harness-master\//, "") + ":" + (i + 1) + ": " + l.trim().slice(0, 120));
      }
    });
  }
}
dirs.forEach((d) => walk(d, 0));
console.log(hits.slice(0, 40).join("\n") || "no messaging hits");
