#!/usr/bin/env node
/**
 * fix-encoding.js — 修复 PowerShell GBK 误读造成的乱码（全仓扫描 + 逆转）
 *
 * 根因：Windows PowerShell 5.1 Get-Content 默认按系统 ANSI(GBK) 解码 UTF-8
 * 文件，Set-Content 再按 UTF-8 写回——中文变成 "\u951B\u93C4..." 一类的
 * 乱码串。该损坏是双射可逆的：乱码串按 GBK 编码回字节、再按 UTF-8 解码
 * 即恢复原文（Node TextDecoder('gbk') 支持）。
 *
 * 判据（行级）：该行包含乱码特征字（\u 转义表；正常中文几乎不出现）；
 * 逆转后 ① 乱码特征归零 ② 常见汉字明显增多（>=6）——才替换，否则保留
 * （宁可漏修不可错改）。
 *
 * 用法：
 *   node scripts/fix-encoding.js --check   # 只报告不改
 *   node scripts/fix-encoding.js           # 修复（UTF-8 无 BOM 写回）
 */

import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = "G:\\deepseek-harness-master\\apps\\mirach";
const CHECK_ONLY = process.argv.includes("--check");

const SKIP_DIRS = new Set(["node_modules", "dist", "target", ".git", "dist-portable", "lib", "cache", ".pnpm-store"]);
const TYPES = new Set([".ts", ".tsx", ".js", ".mjs", ".rs", ".md", ".json", ".yaml", ".yml", ".css", ".html", ".ps1", ".bat", ".cmd", ".txt", ".csv"]);

// GBK 误读产生的乱码特征字（\u 转义，避免正则元字符与源乱码混入）
const NOISE = /[\u951B\u93C4\u9225\u93C8\u6769\u93B4\u9428\u6D93\u6D60\u9359\u9352\u934F\u95AB\u68EC\u59F9\u6924\u7EAD\u5A13\u74D2\u935F\u93B5\u93C3\u942A\u942B\u9286\u9289\u9288\u951D\u951C]/u;
const CJK = /[\u4e00-\u9fff]/;

function isSource(p) { return TYPES.has(extname(p).toLowerCase()); }
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (st.isFile() && isSource(full)) out.push(full);
  }
  return out;
}

/** 乱码 → GBK 字节 → UTF-8 解码（charCodeAt 低字节无损取字节） */
function revive(line) {
  try {
    const bytes = new Uint8Array(line.length);
    for (let i = 0; i < line.length; i++) bytes[i] = line.charCodeAt(i) & 0xff;
    return new TextDecoder("gbk").decode(bytes);
  } catch { return null; }
}

function fixLine(line) {
  if (!NOISE.test(line)) return null;
  const revived = revive(line);
  if (revived === null) return null;
  if (NOISE.test(revived)) return null;                    // ① 乱码未消除 -> 放弃
  const cjk = (revived.match(CJK) || []).length;
  if (cjk < 6) return null;                                // ② 汉字不足 -> 放弃
  return revived;
}

const files = walk(ROOT, []);
let totalFiles = 0;
let totalLines = 0;
const report = [];

for (const file of files) {
  let raw;
  try { raw = readFileSync(file, "utf8"); } catch { continue; }
  const lines = raw.split(/\r?\n/);
  let changed = 0;
  const out = lines.map((line) => {
    const fixed = fixLine(line);
    if (fixed === null) return line;
    changed += 1;
    return fixed;
  });
  if (changed === 0) continue;
  totalFiles += 1;
  totalLines += changed;
  report.push(`${file}: ${changed} 行`);
  if (!CHECK_ONLY) writeFileSync(file, out.join("\n"), "utf8");
}

console.log(CHECK_ONLY ? "== 检查模式（未写文件）==" : "== 修复完成 ==");
console.log(`命中文件 ${totalFiles} 个，乱码行 ${totalLines} 处`);
for (const line of report) console.log("  " + line);
