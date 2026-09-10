// _measure_prune.mjs — 量化 node_modules 里可裁剪的内容（Node 遍历，避免 PS 解析问题）
import fs from "node:fs";
import path from "node:path";

const nm = path.join(process.env.LOCALAPPDATA, "MirachRuntime", "agent-sidecar", "node_modules");
const MB = (n) => (n / 1048576).toFixed(1);

const buckets = {
  total: 0,
  md: 0,
  map: 0,
  ts: 0,
  tests: 0,
  binShims: 0,
  nodePtyPrebuilds: 0,
  sharpLibvips: 0,
  fileCount: 0,
};
const biggest = [];

function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(p);
    } else if (e.isFile()) {
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      const rel = p.slice(nm.length + 1);
      buckets.total += st.size;
      buckets.fileCount += 1;
      const ext = path.extname(e.name).toLowerCase();
      if (ext === ".md") buckets.md += st.size;
      if (ext === ".map") buckets.map += st.size;
      if (ext === ".ts") buckets.ts += st.size;
      if (/[\\/](test|tests|__tests__|spec|examples|docs)[\\/]/i.test(rel)) buckets.tests += st.size;
      if (/[\\/]\.bin[\\/]/.test(rel)) buckets.binShims += st.size;
      if (/node-pty[\\/]prebuilds/.test(rel)) buckets.nodePtyPrebuilds += st.size;
      if (/@img[\\/].*(libvips|sharp)/i.test(rel)) buckets.sharpLibvips += st.size;
      biggest.push([st.size, rel]);
    }
  }
}
walk(nm);

console.log(`node_modules: ${MB(buckets.total)} MB / ${buckets.fileCount} files`);
console.log(`  *.md              : ${MB(buckets.md)} MB`);
console.log(`  *.map             : ${MB(buckets.map)} MB`);
console.log(`  *.ts (纯源码/声明) : ${MB(buckets.ts)} MB`);
console.log(`  test/docs/examples: ${MB(buckets.tests)} MB`);
console.log(`  .bin 垫片          : ${MB(buckets.binShims)} MB`);
console.log(`  node-pty prebuilds: ${MB(buckets.nodePtyPrebuilds)} MB`);
console.log(`  @img (sharp/vips) : ${MB(buckets.sharpLibvips)} MB`);
biggest.sort((a, b) => b[0] - a[0]);
console.log("--- 最大的 12 个文件");
for (const [size, rel] of biggest.slice(0, 12)) console.log(`  ${MB(size).padStart(8)} MB  ${rel}`);
