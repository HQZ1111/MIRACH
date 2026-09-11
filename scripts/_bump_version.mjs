// _bump_version.mjs — 版本号三处同步（package.json / tauri.conf.json / Cargo.toml）
import { readFileSync, writeFileSync } from "node:fs";

const to = process.argv[2];
if (!/^\d+\.\d+\.\d+/.test(to || "")) {
  console.error("usage: node scripts/_bump_version.mjs 0.1.3");
  process.exit(1);
}
const targets = [
  ["package.json", /("version"\s*:\s*")[^"]+(")/],
  ["src-tauri/tauri.conf.json", /("version"\s*:\s*")[^"]+(")/],
  ["src-tauri/Cargo.toml", /(^version\s*=\s*")[^"]+(")/m],
];
for (const [f, re] of targets) {
  const src = readFileSync(f, "utf8");
  if (!re.test(src)) {
    console.log(`${f}: version pattern not found`);
    continue;
  }
  const out = src.replace(re, `$1${to}$2`);
  writeFileSync(f, out, "utf8");
  console.log(`${f}: -> ${to}`);
}
