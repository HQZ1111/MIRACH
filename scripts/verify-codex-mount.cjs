const fs = require("fs");
const path = require("path");
const prof = "C:/Users/Administrator/.mirach/profiles/mirach";
// 找生成/解析产物里的 codex 行
function scan(dir, depth) {
  if (depth > 1) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = dir + "/" + e.name;
    if (e.isFile() && /\.ya?ml$/.test(e.name)) {
      const t = fs.readFileSync(p, "utf8");
      if (/subagent-codex|tool-codex/.test(t)) {
        console.log("== " + p + " ==");
        t.split("\n").forEach((l, i) => { if (/codex/.test(l)) console.log(i + 1 + ": " + l.trim().slice(0, 120)); });
      }
    }
  }
}
scan(prof, 0);
// 也看根生成的模块清单
for (const f of ["cordis.generated.yml", "cordis.yml", "cordis.patch.yml"]) {
  const p = prof + "/" + f;
  if (fs.existsSync(p)) {
    const t = fs.readFileSync(p, "utf8");
    const hit = /codex/.test(t);
    console.log(f + ": codex " + (hit ? "PRESENT" : "absent"));
  }
}
