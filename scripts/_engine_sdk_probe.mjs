// _engine_sdk_probe.mjs — 用官方 SDK（sidecar 同款）起一次引擎，验证"应用路径"能不能就绪。
//
// 比 _engine_boot_probe.mjs 更进一步：走 initialize 握手（引擎真正 ready 才算过），
// 报错也原样带出来（sidecar/UI 那层只剩人话）。
//
// 用法：
//   node scripts/_engine_sdk_probe.mjs                       # 现状
//   node scripts/_engine_sdk_probe.mjs --add dsh-multi-model-provider
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const ADD = (() => {
  const i = process.argv.indexOf("--add");
  return i >= 0 ? process.argv.slice(i + 1).filter((a) => !a.startsWith("--")) : [];
})();
const HOME = process.env.USERPROFILE;
const DSH_HOME = process.env.DSH_HOME || join(HOME, ".mirach");
const RUNTIME = join(process.env.LOCALAPPDATA, "MirachRuntime");
const SIDE = join(RUNTIME, "agent-sidecar");
const DSH_BIN = join(SIDE, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const SDK = join(SIDE, "node_modules", "@deepseek-ai", "dsh-sdk-client", "lib", "index.js");
const PATCH = join(SIDE, "config", "mirach.cordis.patch.yml");
const PROFILE_DIR = join(DSH_HOME, "profiles", "mirach");
const PROFILE = join(PROFILE_DIR, "package.json");

for (const [label, p] of [["dsh bin", DSH_BIN], ["sdk", SDK], ["patch", PATCH], ["profile", PROFILE]]) {
  if (!existsSync(p)) {
    console.error(`missing ${label}: ${p}`);
    process.exit(1);
  }
}

const backup = PROFILE + ".sdkprobe-backup";
copyFileSync(PROFILE, backup);
const restore = () => {
  try {
    writeFileSync(PROFILE, readFileSync(backup, "utf8"), "utf8");
  } catch (e) {
    console.error("[sdkprobe] restore failed: " + e.message);
  }
};
process.on("exit", restore);

if (ADD.length > 0) {
  const manifest = JSON.parse(readFileSync(PROFILE, "utf8"));
  manifest.dsh = manifest.dsh ?? {};
  manifest.dsh.profile = manifest.dsh.profile ?? {};
  const bundles = manifest.dsh.profile.bundles ?? [];
  // 追加在末尾（默认），或 --add-before <anchor> 插到某行之前（试探插件顺序依赖）
  const beforeIdx = process.argv.indexOf("--add-before");
  const anchor = beforeIdx >= 0 ? process.argv[beforeIdx + 1] : null;
  for (const name of ADD) if (!bundles.includes(name)) {
    const at = anchor ? bundles.findIndex((b) => b.includes(anchor)) : -1;
    if (at >= 0) bundles.splice(at, 0, name);
    else bundles.push(name);
  }
  manifest.dsh.profile.bundles = bundles;
  writeFileSync(PROFILE, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log("[sdkprobe] added to bundles: " + ADD.join(", ") + (anchor ? ` (before ${anchor})` : ""));
}
console.log(
  "[sdkprobe] bundles = " + JSON.stringify(JSON.parse(readFileSync(PROFILE, "utf8")).dsh?.profile?.bundles ?? []),
);

const { DeepSeekHarness } = await import(pathToFileURL(SDK).href);
const harness = new DeepSeekHarness({
  dshBin: DSH_BIN,
  profile: "mirach",
  dshHome: DSH_HOME,
  ...(existsSync(PATCH) ? { patches: [PATCH] } : {}),
  processCwd: PROFILE_DIR,
  cwd: HOME,
  env: {
    ...process.env,
    DSH_HOME,
    DSH_CWD: HOME,
    MIRACH_WEB_PORT: "3288",
    MIRACH_WEB_HOST: "127.0.0.1",
    DSH_EFFORT: "high",
  },
  initializeTimeoutMs: 120_000,
  requestTimeoutMs: 120_000,
  provider: "deepseek-official",
  model: "deepseek/deepseek-v4-flash-0731",
});

const t0 = Date.now();
try {
  await harness.start();
  console.log(`\n[sdkprobe] RESULT=READY after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
} catch (e) {
  console.log(`\n[sdkprobe] RESULT=FAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("[sdkprobe] error: " + (e && e.message ? e.message : String(e)));
  if (e && e.stack) console.log("[sdkprobe] stack: " + String(e.stack).split("\n").slice(0, 12).join("\n"));
} finally {
  await harness.close?.().catch?.(() => {});
  process.exit(0);
}
