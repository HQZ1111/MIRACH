// _plugin_versions.mjs — 查 npm 上各插件的最新版本 vs 本地已装版本（A 线：插件更新检查）
const PLUGINS = [
  "dsh-multi-model-provider",
  "dsh-realtime-voice",
  "dsh-tavern",
  "dsh-workgroup",
  "dsh-muv-engine",
  "dsh-muv-table",
  "dsh-pocket",
  "@deepseek-ai/dsh-subagent-codex",
  "@deepseek-ai/dsh-subagent-claude-code",
  "@deepseek-ai/dsh-client-runtime",
];

const local = (name) => {
  const paths = [
    `${process.env.USERPROFILE}\\.mirach\\profiles\\mirach\\node_modules\\${name}\\package.json`,
    `${process.env.LOCALAPPDATA}\\MirachRuntime\\agent-sidecar\\node_modules\\${name}\\package.json`,
  ];
  for (const p of paths) {
    try {
      return { version: JSON.parse(require("node:fs").readFileSync(p, "utf8")).version, path: p };
    } catch {
      /* keep looking */
    }
  }
  return { version: null, path: null };
};

import { readFileSync } from "node:fs";

for (const name of PLUGINS) {
  let info = { version: null, path: null };
  for (const p of [
    `${process.env.USERPROFILE}\\.mirach\\profiles\\mirach\\node_modules\\${name}\\package.json`,
    `${process.env.LOCALAPPDATA}\\MirachRuntime\\agent-sidecar\\node_modules\\${name}\\package.json`,
  ]) {
    try {
      info = { version: JSON.parse(readFileSync(p, "utf8")).version, path: p };
      break;
    } catch {
      /* next */
    }
  }
  let tags = {};
  let versions = [];
  try {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) {
      const j = await res.json();
      tags = j["dist-tags"] ?? {};
      versions = Object.keys(j.versions ?? {});
    } else {
      tags = { error: "HTTP " + res.status };
    }
  } catch (e) {
    tags = { error: String(e.message || e).slice(0, 60) };
  }
  const tail = versions.slice(-6).join(", ");
  console.log(
    `${name}\n  local=${info.version ?? "(not installed)"}  dist-tags=${JSON.stringify(tags)}\n  last versions: ${tail}`,
  );
}
void local;
