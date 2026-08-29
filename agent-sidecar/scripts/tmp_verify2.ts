import { readFileSync } from "node:fs";

const text = readFileSync("C:/Users/Administrator/.hermes/dsh-sessions/_snapshot.jsonl", "utf8");
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  let j: { type?: string; data?: Record<string, unknown> };
  try {
    j = JSON.parse(line) as { type?: string; data?: Record<string, unknown> };
  } catch {
    continue;
  }
  if (j.type === "assistant/message") {
    const d = j.data ?? {};
    const content = (d as { message?: { content?: { type?: string }[] } }).message?.content ?? [];
    console.log("AM turn=", JSON.stringify(d.turn), "step=", JSON.stringify(d.step), "types=", JSON.stringify(content.map((c) => c.type)));
  }
}