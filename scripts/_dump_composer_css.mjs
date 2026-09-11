// _dump_composer_css.mjs — 官方 composer 的 CSS 里 pa_row / pa_scroll / pa_card 的原始规则
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.env.LOCALAPPDATA, "MirachRuntime/agent-sidecar/node_modules/@deepseek-ai");
const pkgs = readdirSync(dir).filter((n) => n.includes("conversation") || n.includes("composer") || n.includes("input"));
for (const p of pkgs) {
  const f = join(dir, p, "lib", "client.js");
  let src;
  try {
    src = readFileSync(f, "utf8");
  } catch {
    continue;
  }
  const m = src.match(/const css = "((?:[^"\\]|\\.)*)";/);
  if (!m) continue;
  const css = m[1].replace(/\\"/g, '"');
  const wanted = ["pa_row", "pa_scroll", "pa_card", "pa_root", "pa_grow", "pa_tools", "pa_trailing"];
  const rules = css.split("}").filter((r) => wanted.some((w) => r.includes(w)));
  if (rules.length === 0) continue;
  console.log(`===== ${p} =====`);
  for (const r of rules.slice(0, 30)) console.log(r.replace(/\s+/g, " ").trim() + "}");
}
