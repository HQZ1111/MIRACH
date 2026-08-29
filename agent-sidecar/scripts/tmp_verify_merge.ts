import { readFileSync } from "node:fs";
import { parseSessionLog } from "../src/history.js";

const text = readFileSync("C:/Users/Administrator/.hermes/dsh-sessions/_snapshot.jsonl", "utf8");
const msgs = parseSessionLog(text);
console.log("parsed messages:", msgs.length);
for (const m of msgs) {
  console.log(
    "-",
    m.role,
    "| text:", (m.text || "").slice(0, 36),
    "| thinking:", m.thinking ? m.thinking.length + "ch" : "-",
    "| toolCalls:", m.toolCalls?.map((t) => t.name).join(",") || "-",
    "| compaction:", m.compaction ? "Y" : "",
  );
}