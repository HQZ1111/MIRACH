// _activate_plugin.mjs — 把某个插件加进 dsh.profile.bundles（官方清单写入语义：2 空格 + 尾换行）
// 用法：node scripts/_activate_plugin.mjs dsh-im [--remove]
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const name = process.argv[2];
const remove = process.argv.includes("--remove");
if (!name) {
  console.error("usage: node scripts/_activate_plugin.mjs <pkg> [--remove]");
  process.exit(1);
}
const PROFILE = join(process.env.USERPROFILE, ".mirach", "profiles", "mirach", "package.json");
const raw = readFileSync(PROFILE, "utf8");
copyFileSync(PROFILE, PROFILE + ".activate-backup");
const manifest = JSON.parse(raw);
manifest.dsh = manifest.dsh ?? {};
manifest.dsh.profile = manifest.dsh.profile ?? {};
const bundles = manifest.dsh.profile.bundles ?? [];
const before = [...bundles];
if (remove) {
  manifest.dsh.profile.bundles = bundles.filter((b) => b !== name);
} else if (!bundles.includes(name)) {
  bundles.push(name);
  manifest.dsh.profile.bundles = bundles;
}
writeFileSync(PROFILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log("bundles before: " + JSON.stringify(before));
console.log("bundles after : " + JSON.stringify(manifest.dsh.profile.bundles));
console.log("backup: " + PROFILE + ".activate-backup");
