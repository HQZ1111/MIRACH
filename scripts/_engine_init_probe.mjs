// _engine_init_probe.mjs — 直接起引擎 + 手写 initialize 握手，把**引擎原始输出**全打出来。
//
// 为什么不用 SDK：SDK 把 initialize 的错误包成一句 JsonRpcResponseError（"cannot create
// effect on inactive context"），看不到是哪个插件/服务挂的。手写握手能看到引擎 stderr 全文。
//
// 用法：
//   node scripts/_engine_init_probe.mjs 45
//   node scripts/_engine_init_probe.mjs 45 --add dsh-multi-model-provider
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";

const SECONDS = Number(process.argv[2] || 45);
const ADD = (() => {
  const i = process.argv.indexOf("--add");
  return i >= 0 ? process.argv.slice(i + 1).filter((a) => !a.startsWith("--")) : [];
})();
const HOME = process.env.USERPROFILE;
const DSH_HOME = process.env.DSH_HOME || join(HOME, ".mirach");
const RUNTIME = join(process.env.LOCALAPPDATA, "MirachRuntime");
const NODE = join(RUNTIME, "node", "node.exe");
const SIDE = join(RUNTIME, "agent-sidecar");
const ENGINE = join(SIDE, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const PATCH = join(SIDE, "config", "mirach.cordis.patch.yml");
const PROFILE = join(DSH_HOME, "profiles", "mirach", "package.json");

for (const [label, p] of [["node", NODE], ["engine", ENGINE], ["profile", PROFILE]]) {
  if (!existsSync(p)) {
    console.error(`missing ${label}: ${p}`);
    process.exit(1);
  }
}
const backup = PROFILE + ".initprobe-backup";
copyFileSync(PROFILE, backup);
process.on("exit", () => {
  try {
    writeFileSync(PROFILE, readFileSync(backup, "utf8"), "utf8");
  } catch (e) {
    console.error("[initprobe] restore failed: " + e.message);
  }
});
if (ADD.length > 0) {
  const manifest = JSON.parse(readFileSync(PROFILE, "utf8"));
  manifest.dsh = manifest.dsh ?? {};
  manifest.dsh.profile = manifest.dsh.profile ?? {};
  const bundles = manifest.dsh.profile.bundles ?? [];
  for (const n of ADD) if (!bundles.includes(n)) bundles.push(n);
  manifest.dsh.profile.bundles = bundles;
  writeFileSync(PROFILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("[initprobe] added: " + ADD.join(", "));
}

const child = spawn(NODE, [ENGINE, "--profile", "mirach", "--patch", PATCH], {
  cwd: HOME,
  env: {
    ...process.env,
    DSH_HOME,
    DSH_CWD: HOME,
    MIRACH_PROFILE: "1",
    MIRACH_WEB_HOST: "127.0.0.1",
    MIRACH_WEB_PORT: "3299",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const stamp = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6);
const t0 = Date.now();
const show = (tag) => (buf) => {
  for (const line of String(buf).split(/\r?\n/)) if (line.trim()) console.log(`[${stamp()}s ${tag}] ${line}`);
};
child.stdout.on("data", show("out"));
child.stderr.on("data", show("err"));
child.on("exit", (code, sig) => console.log(`[${stamp()}s] engine exited code=${code} sig=${sig}`));

setTimeout(() => {
  const params = {
    cwd: HOME,
    provider: "deepseek-official",
    model: "deepseek/deepseek-v4-flash-0731",
    reasoningEffort: "high",
  };
  const req = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params }) + "\n";
  console.log(`[${stamp()}s ->] initialize ${JSON.stringify(params)}`);
  child.stdin.write(req);
}, 6000);

setTimeout(() => {
  console.log(`[${stamp()}s] killing`);
  child.kill("SIGKILL");
  setTimeout(() => process.exit(0), 400);
}, SECONDS * 1000);
