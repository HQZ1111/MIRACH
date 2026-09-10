// _engine_boot_probe.mjs — 直接起一次引擎（和 sidecar 同样的 argv/env），把原始输出全捞回来。
//
// 用途：profile bundles 里加了某个插件后引擎起不来时，拿到**原始报错**（sidecar/UI 那层
// 只剩一句人话）。用法：
//   node scripts/_engine_boot_probe.mjs [秒数]
// 前置：先备份 ~/.mirach/profiles/mirach/package.json（脚本自己也会备份/恢复 bundles）。
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const SECONDS = Number(process.argv[2] || 45);
// 额外加进 dsh.profile.bundles 的插件（探针退出时连同 profile 一起恢复）：
//   node scripts/_engine_boot_probe.mjs 45 --add dsh-multi-model-provider
const ADD = (() => {
  const i = process.argv.indexOf("--add");
  return i >= 0 ? process.argv.slice(i + 1).filter((a) => !a.startsWith("--")) : [];
})();
const HOME = process.env.USERPROFILE;
const DSH_HOME = process.env.DSH_HOME || join(HOME, ".mirach");
const RUNTIME = join(process.env.LOCALAPPDATA, "MirachRuntime");
const NODE = join(RUNTIME, "node", "node.exe");
const ENGINE = join(RUNTIME, "agent-sidecar", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const PATCH = join(RUNTIME, "agent-sidecar", "config", "mirach.cordis.patch.yml");
const PROFILE = join(DSH_HOME, "profiles", "mirach", "package.json");

for (const [label, p] of [["node", NODE], ["engine", ENGINE], ["patch", PATCH], ["profile", PROFILE]]) {
  if (!existsSync(p)) {
    console.error(`missing ${label}: ${p}`);
    process.exit(1);
  }
}
console.log("[probe] engine = " + ENGINE);

// 备份，退出时恢复
const backup = PROFILE + ".probe-backup";
copyFileSync(PROFILE, backup);
if (ADD.length > 0) {
  const manifest = JSON.parse(readFileSync(PROFILE, "utf8"));
  const bundles = manifest?.dsh?.profile?.bundles ?? [];
  for (const name of ADD) if (!bundles.includes(name)) bundles.push(name);
  manifest.dsh = manifest.dsh ?? {};
  manifest.dsh.profile = manifest.dsh.profile ?? {};
  manifest.dsh.profile.bundles = bundles;
  writeFileSync(PROFILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("[probe] probing with ADDED bundles: " + ADD.join(", "));
}
console.log("[probe] profile bundles = " + JSON.stringify(JSON.parse(readFileSync(PROFILE, "utf8")).dsh?.profile?.bundles ?? []));
const restore = () => {
  try {
    writeFileSync(PROFILE, readFileSync(backup, "utf8"), "utf8");
    console.log("[probe] profile restored from backup");
  } catch (e) {
    console.error("[probe] restore failed: " + e.message);
  }
};
process.on("exit", restore);
process.on("SIGINT", () => process.exit(2));

const child = spawn(NODE, [ENGINE, "--profile", "mirach", "--patch", PATCH], {
  cwd: HOME,
  env: {
    ...process.env,
    DSH_HOME,
    DSH_CWD: HOME,
    MIRACH_PROFILE: "1",
    MIRACH_WEB_HOST: "127.0.0.1",
    MIRACH_WEB_PORT: "3099",
    DSH_LLM_PROVIDERS: process.env.DSH_LLM_PROVIDERS || "{}",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const lines = [];
const grab = (tag) => (buf) => {
  for (const line of String(buf).split(/\r?\n/)) {
    if (!line.trim()) continue;
    lines.push(`[${tag}] ${line}`);
    console.log(`[${tag}] ${line}`);
  }
};
child.stdout.on("data", grab("out"));
child.stderr.on("data", grab("err"));
child.on("exit", (code, sig) => {
  console.log(`\n[probe] engine exited code=${code} sig=${sig} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[probe] total lines=${lines.length}`);
});
const t0 = Date.now();
setTimeout(() => {
  console.log(`\n[probe] killing after ${SECONDS}s (still running = boot OK)`);
  child.kill("SIGKILL");
  setTimeout(() => process.exit(0), 500);
}, SECONDS * 1000);
