import { readFileSync, writeFileSync, rmSync } from "node:fs";

const p = "src/components/layout/MainPanel.tsx";
const c = readFileSync(p, "utf8");
const repl = readFileSync("scripts/_gallery.tsx", "utf8");

const fnAt = c.indexOf("function ProjectGalleryHero");
const start = c.lastIndexOf("/**", fnAt);
const end = c.indexOf("/** dsh", fnAt);
if (fnAt === -1 || start === -1 || end === -1 || end <= start) throw new Error("markers not found: " + fnAt + "," + start + "," + end);

const next = c.slice(0, start) + repl.trimEnd() + "\n\n" + c.slice(end);
writeFileSync(p, next, "utf8");
rmSync("scripts/_gallery.tsx");
console.log("spliced, new length:", next.length);