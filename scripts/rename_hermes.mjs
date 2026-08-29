import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Hermes → Mirach 品牌统一（用户可见文案 + 函数名 + 注释）。
// 保留功能性小写标识：localStorage 旧键名文档（hermes.*）、OBF_SEED、视图 id 兼容
// （它们改了会破坏数据迁移/已存密码解密）。hermes.local 假 URL 一并更名。

const roots = ["src"];
const exts = new Set([".ts", ".tsx"]);
const skipDirs = new Set(["node_modules", "dist", ".git"]);

let changed = 0;
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!skipDirs.has(name)) walk(p);
      continue;
    }
    if (!exts.has(name.slice(name.lastIndexOf(".")))) continue;
    let s = readFileSync(p, "utf8");
    const before = s;
    s = s.replace(/Hermes/g, "Mirach");
    s = s.replace(/hermes\.local/g, "mirach.local");
    if (s !== before) {
      writeFileSync(p, s, "utf8");
      changed++;
      console.log("updated:", p);
    }
  }
};
for (const r of roots) walk(r);
console.log("files changed:", changed);