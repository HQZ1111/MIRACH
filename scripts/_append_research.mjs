import { readFileSync, writeFileSync, rmSync } from "node:fs";
const doc = "docs/research-isolation.md";
const add = readFileSync("scripts/_research_add.md", "utf8");
writeFileSync(doc, readFileSync(doc, "utf8").replace(/\n*$/, "\n") + add, "utf8");
rmSync("scripts/_research_add.md");
console.log("appended");