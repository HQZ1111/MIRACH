// _hermes_slots.mjs — 这些 HUD CSS 用的 slot 名，是 hermes 自己定义的还是官方 dsh 的？
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "D:/hermes-agent-main/apps/desktop/src";
const SLOTS = ["composer-dock", "composer-bounds", "aui_thread-viewport", "aui_thread-content", "composer-rich-input"];

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx?|css)$/.test(name)) files.push(p);
  }
};
walk(ROOT);

const hits = new Map(SLOTS.map((s) => [s, []]));
for (const f of files) {
  const t = readFileSync(f, "utf8");
  for (const s of SLOTS) {
    if (t.includes(s)) hits.get(s).push(f.replace(ROOT + "/", ""));
  }
}
for (const [slot, list] of hits) {
  console.log(`\n=== ${slot} ===`);
  console.log(list.length === 0 ? "(not found)" : list.slice(0, 8).join("\n"));
}

// RICH_INPUT_SLOT 的值
const re = readFileSync(join(ROOT, "app/chat/composer/rich-editor.tsx"), "utf8");
const m = re.match(/RICH_INPUT_SLOT\s*=\s*([^\n;]+)/);
console.log("\nRICH_INPUT_SLOT =", m ? m[1].trim() : "(not found)");

// hermes 里是否有官方 dsh 的 conversation.* slot（对照）
const conv = [];
for (const f of files) {
  const t = readFileSync(f, "utf8");
  if (t.includes("conversation.composer")) conv.push(f.replace(ROOT + "/", ""));
}
console.log("\n使用官方 conversation.* slot 的文件:", conv.length ? conv.slice(0, 8).join(", ") : "(无)");
