import { readFileSync, writeFileSync } from "node:fs";
const p = "src/store/agents.ts";
const c = readFileSync(p, "utf8");
const start = c.indexOf("// 演示种子仅 mock 构建");
const end = c.indexOf("const AVATAR_COLORS");
if (start === -1 || end === -1 || end <= start) throw new Error("markers not found: " + start + "," + end);
const next = c.slice(0, start) + c.slice(end);
writeFileSync(p, next, "utf8");
console.log("SEED removed, new length:", next.length);