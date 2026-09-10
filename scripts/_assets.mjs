// _assets.mjs — 列出 Gitee release 资产（UTF-8 安全，避免 PS 5.1 的 ANSI 读取坑）
// 用法: node scripts/_assets.mjs [tag]
import fs from "node:fs";

const tag = process.argv[2] ?? "v0.1.2";
const pat = fs.readFileSync(new URL("./_gitee_pat.txt", import.meta.url), "utf8").trim();
const res = await fetch(`https://gitee.com/api/v5/repos/HANQINGZHOU/mirach/releases/tags/${tag}`, {
  headers: { Authorization: `token ${pat}` },
});
const text = await res.text();
let rel;
try {
  rel = JSON.parse(text);
} catch {
  console.log("non-JSON response:", text.slice(0, 300));
  process.exit(1);
}
console.log(`release ${rel.tag_name} id=${rel.id} name=${rel.name}`);
for (const a of rel.assets ?? []) {
  console.log(` - ${a.name}  (${a.browser_download_url})`);
}
