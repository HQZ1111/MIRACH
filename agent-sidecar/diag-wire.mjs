// 实测：引擎 runtime 的 typert wire 端点命名（dot vs slash）
import { DeepSeekHarness } from "@deepseek-ai/dsh-sdk-client";
import { existsSync } from "node:fs";
import { join } from "node:path";

const APPDATA = process.env.APPDATA ?? "";
const npmDshBin = join(APPDATA, "npm", "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
const profile = join(
  process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? "", ".mirach"),
  "profiles",
  "mirach",
);

const harness = new DeepSeekHarness({
  launch: {
    command: "D:\\node.exe",
    args: [npmDshBin, "--profile", "mirach"],
    cwd: profile,
    env: {
      DSH_HOME: join(process.env.DSH_HOME ?? process.env.USERPROFILE ?? "", ".mirach"),
      MIRACH_WEB_PORT: "3212",
      MIRACH_WEB_HOST: "127.0.0.1",
    },
  },
  cwd: profile,
  provider: "deepseek-official",
  model: "deepseek-v4-flash-0731",
});

await harness.start();
console.log("[diag] harness started");

const probe = async (label, method, params) => {
  try {
    const r = await harness.client.request(method, params, 15000);
    console.log(`[diag] ${label} OK ->`, JSON.stringify(r).slice(0, 160));
  } catch (e) {
    console.log(`[diag] ${label} ERR ->`, String(e).slice(0, 220));
  }
};

await probe("session.modelCatalog (dot)", "session.modelCatalog", {});
await probe("session/modelCatalog (slash)", "session/modelCatalog", {});
await probe("session/selectModel (slash)", "session/selectModel", {
  sessionId: "probe-session", provider: "deepseek", model: "deepseek-v4-flash-0731",
});
await probe("session.selectModel (dot)", "session.selectModel", {
  sessionId: "probe-session", provider: "deepseek", model: "deepseek-v4-flash-0731",
});
await probe("commands.execute (slash, positional)", "commands/execute", ["probe-session", "/plan on", []]);
await probe("commands.execute (dot, positional)", "commands.execute", ["probe-session", "/plan on", []]);
await probe("commands.execute (slash, object)", "commands.execute", { agent: "probe-session", line: "/plan on", images: [] });
await probe("settings/describe (slash)", "settings/describe", {});
await probe("settings.describe (dot)", "settings.describe", {});
await probe("agentPresets/select (slash)", "agentPresets/select", ["probe-session", "standard"].length ? { agentId: "probe-session", agentPreset: "standard" } : {});
await probe("goals/ref check (slash, edit)", "goals/edit", ["probe-session", null, { objective: "x" }]);

await harness.close().catch(() => {});
console.log("[diag] done");
