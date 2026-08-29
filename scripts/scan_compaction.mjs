// Scan all dsh session logs for compaction events and per-turn input sizes.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";

const root = "C:/Users/Administrator/.hermes/dsh-sessions";
function walk(dir, depth, out) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const n of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, n.name);
    if (n.isDirectory()) walk(p, depth + 1, out);
    else if (n.name === "session.jsonl.zstd" || n.name === "session.jsonl") out.push(p);
  }
}
const files = [];
walk(root, 0, files);
let compactionEvents = 0;
for (const f of files) {
  let text = "";
  try {
    if (f.endsWith(".zstd")) {
      const buf = readFileSync(f);
      const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
      const frames = [];
      let pos = 0;
      while (pos < buf.length - 3) {
        if (buf[pos] === 0x28 && buf[pos + 1] === 0xb5 && buf[pos + 2] === 0x2f && buf[pos + 3] === 0xfd) { frames.push(pos); pos += 4; } else pos++;
      }
      for (let i = 0; i < frames.length; i++) {
        const fr = buf.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : buf.length);
        try { text += zstdDecompressSync(fr).toString("utf8"); } catch {}
      }
    } else text = readFileSync(f, "utf8");
  } catch { continue; }
  let lastInput = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    if (/compaction/i.test(line)) { compactionEvents++; if (compactionEvents <= 5) console.log("COMPACTION:", f, "→", line.slice(0, 220)); continue; }
    try {
      const ev = JSON.parse(line);
      if (ev.type === "assistant/chunk") {
        const u = ev.data?.chunk?.usage;
        if (u?.inputTokens) lastInput = u.inputTokens;
      }
    } catch {}
  }
  console.log(`${f.replace(root, "")} lastInputTokens=${lastInput}`);
}
console.log("TOTAL_COMPACTION_LINES =", compactionEvents);
