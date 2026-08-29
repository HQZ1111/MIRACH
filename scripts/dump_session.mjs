// Dump the newest dsh session log as readable user/assistant messages.
// Scans %USERPROFILE%\.hermes\dsh-sessions (or DSH_SESSION_ROOT) recursively
// for session.jsonl.zstd / session.jsonl, takes the newest by mtime, parses it.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import os from "node:os";

const roots = [process.env.DSH_SESSION_ROOT, join(os.homedir(), ".hermes", "dsh-sessions")].filter(Boolean);

function walk(dir, depth, out) {
  if (depth > 4) return;
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, depth + 1, out);
    else if (name.name === "session.jsonl.zstd" || name.name === "session.jsonl") {
      out.push({ path: p, mtime: statSync(p).mtimeMs });
    }
  }
}

const files = [];
for (const r of roots) walk(r, 0, files);
files.sort((a, b) => b.mtime - a.mtime);
if (files.length === 0) {
  console.log("NO_SESSION_FILES (roots: " + roots.join(" | ") + ")");
  process.exit(0);
}
const target = files[0];
console.log(`=== SESSION FILE: ${target.path} (mtime ${new Date(target.mtime).toISOString()}) ===`);

let text = "";
if (target.path.endsWith(".zstd")) {
  const buf = readFileSync(target.path);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const frames = [];
  let pos = 0;
  while (pos < buf.length - 3) {
    if (buf[pos] === magic[0] && buf[pos + 1] === magic[1] && buf[pos + 2] === magic[2] && buf[pos + 3] === magic[3]) {
      frames.push(pos);
      pos += 4;
    } else pos++;
  }
  for (let i = 0; i < frames.length; i++) {
    const frame = buf.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : buf.length);
    try {
      text += zstdDecompressSync(frame).toString("utf8");
    } catch {}
  }
} else {
  text = readFileSync(target.path, "utf8");
}

// --- parse: user/message + assistant/message (+ tool-call counts) ---
let userCount = 0, asstCount = 0;
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  let ev;
  try { ev = JSON.parse(line); } catch { continue; }
  const d = ev.data ?? {};
  if (ev.type === "user/message" && d.role === "user") {
    const so = ev.surfaceOp;
    const isReplace = so === "replace" || (typeof so === "object" && so && so.op === "replace");
    if (isReplace) continue;
    const t = (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    if (t) { userCount++; console.log(`\n[user] ${t}`); }
  } else if (ev.type === "assistant/message" && d.message?.role === "assistant") {
    const parts = d.message.content ?? [];
    const t = parts.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    const th = parts.filter((c) => c.type === "reasoning").map((c) => c.text ?? "").join("");
    const tc = parts.filter((c) => c.type === "tool-call").length;
    asstCount++;
    console.log(`\n[assistant] thinking=${th.length} chars, toolCalls=${tc}, text=${t.length} chars`);
    if (th) console.log(`  THINK: ${th.slice(0, 400)}`);
    if (t) console.log(`  TEXT: ${t.slice(0, 800)}`);
    if (tc) console.log(`  TOOLS: ${parts.filter((c) => c.type === "tool-call").map((c) => c.name).join(", ")}`);
  }
}
console.log(`\n=== SUMMARY: user=${userCount} assistant=${asstCount} ===`);
