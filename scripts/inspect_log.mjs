import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import os from "node:os";

// find newest session log
function walk(dir, depth, out) {
  if (depth > 4 || !existsSync(dir)) return;
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, name.name);
    if (name.isDirectory()) walk(p, depth + 1, out);
    else if (name.name === "session.jsonl.zstd" || name.name === "session.jsonl") out.push({ path: p, mtime: statSync(p).mtimeMs });
  }
}
const files = [];
walk(join(os.homedir(), ".hermes", "dsh-sessions"), 0, files);
files.sort((a, b) => b.mtime - a.mtime);
const target = files[0];
console.log("FILE:", target.path);

let all = "";
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
    const f = buf.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : buf.length);
    try { all += zstdDecompressSync(f).toString("utf8"); } catch (e) { console.log("frame", i, "FAIL", e.message); }
  }
} else {
  all = readFileSync(target.path, "utf8");
}

const lines = all.split("\n").filter(Boolean);
console.log("TOTAL_LINES", lines.length);
let n = 0;
for (const l of lines) {
  let ev;
  try { ev = JSON.parse(l); } catch { continue; }
  const t = ev.type || "";
  const d = ev.data ?? {};
  if (t.includes("user/message")) {
    const txt = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    console.log(`[${n}] user/message text=${JSON.stringify(txt.slice(0, 60))} surfaceOp=${JSON.stringify(ev.surfaceOp ?? d.surfaceOp ?? null)}`);
  } else if (t.includes("turn/end")) {
    console.log(`[${n}] turn/end reason=${JSON.stringify(d.reason)}`);
  } else if (t.includes("error")) {
    console.log(`[${n}] ERROR-ish ${t}: ${JSON.stringify(ev.data ?? ev).slice(0, 300)}`);
  } else if (t === "assistant/message") {
    console.log(`[${n}] assistant/message id=${d.message?.id ?? "NONE"} types=${(d.message?.content || []).map((c) => c.type).join(",")}`);
  } else if (t === "message_end") {
    console.log(`[${n}] message_end present`);
  } else if (t === "session/start" || t === "session/end" || t === "inbox/spliced") {
    console.log(`[${n}] ${t}`);
  }
  n++;
}
