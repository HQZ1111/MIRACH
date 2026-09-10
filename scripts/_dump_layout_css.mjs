// _dump_layout_css.mjs — 把官方 AppFrame CSS 模块的整段 CSS 打到文件里
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const f = join(
  process.env.LOCALAPPDATA,
  "MirachRuntime/agent-sidecar/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js",
);
const src = readFileSync(f, "utf8");
const m = src.match(/const css = "((?:[^"\\]|\\.)*)";/);
if (!m) {
  console.error("css string not found");
  process.exit(1);
}
const css = m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
const out = join(process.cwd(), "_layout_module.css");
writeFileSync(out, css.replace(/;/g, ";\n").replace(/\}/g, "}\n"), "utf8");
console.log("wrote " + out + " (" + css.length + " chars)");
