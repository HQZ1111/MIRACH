// _grep_layout.mjs — 在官方 layout client bundle 里找侧栏列的 DOM 契约
import { readFileSync } from "node:fs";
import { join } from "node:path";

const f = join(
  process.env.LOCALAPPDATA,
  "MirachRuntime/agent-sidecar/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js",
);
const src = readFileSync(f, "utf8");
const needles = process.argv.slice(2);
for (const n of needles.length ? needles : ["sidebar", "Sidebar"]) {
  console.log(`===== "${n}" =====`);
  let idx = -1;
  let hits = 0;
  while ((idx = src.indexOf(n, idx + 1)) >= 0 && hits < 8) {
    hits += 1;
    const from = Math.max(0, idx - 160);
    const to = Math.min(src.length, idx + 220);
    console.log("…" + src.slice(from, to).replace(/\s+/g, " ") + "…");
    console.log("");
  }
  if (hits === 0) console.log("(no hit)");
}
