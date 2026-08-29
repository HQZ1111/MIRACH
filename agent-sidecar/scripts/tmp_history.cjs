"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/history.ts
var history_exports = {};
__export(history_exports, {
  parseSessionLog: () => parseSessionLog,
  readSessionHistory: () => readSessionHistory
});
module.exports = __toCommonJS(history_exports);
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");
var import_node_zlib = require("node:zlib");

// src/protocol.ts
var LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
function activeLevel() {
  const raw = process.env.SIDECAR_LOG_LEVEL;
  return raw !== void 0 && raw in LEVELS ? LEVELS[raw] : LEVELS.info;
}
function format(args) {
  const [first, ...rest] = args;
  if (typeof first === "string" && /%[sdj]/.test(first) && rest.length > 0) {
    let i = 0;
    const body = first.replace(/%[sdj]/g, (tag) => {
      const v = rest[i++];
      if (tag === "%d") return String(Number(v));
      if (tag === "%j") return JSON.stringify(v);
      return String(v);
    });
    return rest.length > i ? `${body} ${rest.slice(i).join(" ")}` : body;
  }
  return args.map(String).join(" ");
}
function logAt(level, ...args) {
  if (LEVELS[level] > activeLevel()) return;
  process.stderr.write(`[sidecar:${level}] ${format(args)}
`);
}
var log = (...args) => logAt("info", ...args);
var logWarn = (...args) => logAt("warn", ...args);
var logDebug = (...args) => logAt("debug", ...args);
process.stdout.on("error", (err) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});

// src/history.ts
function sessionDir(sessionRoot, dshId) {
  if (!(0, import_node_fs.existsSync)(sessionRoot)) return null;
  const walk = (dir, depth) => {
    let found = null;
    try {
      for (const name of (0, import_node_fs.readdirSync)(dir, { withFileTypes: true })) {
        if (found) break;
        if (name.isDirectory()) {
          if (name.name === dshId) {
            const logFile = (0, import_node_path.join)(dir, name.name, "session.jsonl.zstd");
            const plain = (0, import_node_path.join)(dir, name.name, "session.jsonl");
            if ((0, import_node_fs.existsSync)(logFile) || (0, import_node_fs.existsSync)(plain)) return (0, import_node_path.join)(dir, name.name);
          } else if (depth < 2) {
            found = walk((0, import_node_path.join)(dir, name.name), depth + 1);
          }
        }
      }
    } catch {
    }
    return found;
  };
  return walk(sessionRoot, 0);
}
function readSessionText(dir) {
  const zstdPath = (0, import_node_path.join)(dir, "session.jsonl.zstd");
  if ((0, import_node_fs.existsSync)(zstdPath)) {
    const buf = (0, import_node_fs.readFileSync)(zstdPath);
    const magic = Buffer.from([40, 181, 47, 253]);
    const frames = [];
    let pos = 0;
    while (pos < buf.length - 3) {
      if (buf[pos] === magic[0] && buf[pos + 1] === magic[1] && buf[pos + 2] === magic[2] && buf[pos + 3] === magic[3]) {
        frames.push(pos);
        pos += 4;
      } else pos++;
    }
    let all = "";
    for (let i = 0; i < frames.length; i++) {
      const frame = buf.subarray(frames[i], i + 1 < frames.length ? frames[i + 1] : buf.length);
      try {
        all += (0, import_node_zlib.zstdDecompressSync)(frame).toString("utf8");
      } catch (err) {
        logDebug("zstd frame %d decode failed: %s", i, err instanceof Error ? err.message : String(err));
      }
    }
    if (all) return all;
    logWarn("multi-frame decode empty for %s \u9225?trying stream decode", dir);
    return readStreamingZstd(buf);
  }
  const plain = (0, import_node_path.join)(dir, "session.jsonl");
  return (0, import_node_fs.existsSync)(plain) ? (0, import_node_fs.readFileSync)(plain, "utf8") : "";
}
function readStreamingZstd(buf) {
  try {
    const z = require("node:zlib");
    const dec = z.createZstdDecompress();
    const chunks = [];
    dec.on("data", (c) => chunks.push(c));
    dec.end(buf);
    return z.zstdDecompressSync(buf).toString("utf8");
  } catch {
    return "";
  }
}
function parseSessionLog(text) {
  const messages = [];
  let turnAcc = null;
  const flushTurn = () => {
    if (!turnAcc) return;
    const merged = {
      role: "assistant",
      text: turnAcc.text,
      ...turnAcc.thinking ? { thinking: turnAcc.thinking } : {},
      ...turnAcc.toolCalls.length > 0 ? { toolCalls: turnAcc.toolCalls } : {}
    };
    if (turnAcc.text || turnAcc.thinking || turnAcc.toolCalls.length > 0) messages.push(merged);
    turnAcc = null;
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const d = ev.data ?? {};
    if (ev.type === "user/message" && d.role === "user") {
      const so = ev.surfaceOp;
      const isReplace = so === "replace" || typeof so === "object" && so !== null && so.op === "replace";
      const text2 = (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const isTimeContext = /^Time sampled while preparing turn \d+, step \d+:/m.test(text2);
      if (isReplace) continue;
      if (isTimeContext) continue;
      flushTurn();
      if (text2) messages.push({ role: "user", text: text2 });
    } else if (ev.type === "assistant/message" && d.message?.role === "assistant") {
      const parts = d.message.content ?? [];
      const text2 = parts.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const thinking = parts.filter((c) => c.type === "reasoning").map((c) => c.text ?? "").join("");
      const toolCalls = parts.filter((c) => c.type === "tool-call").map((c, ci) => {
        let args = {};
        if (c.arguments) {
          try {
            const v = JSON.parse(c.arguments);
            if (v && typeof v === "object") args = v;
          } catch {
            args = { raw: c.arguments };
          }
        }
        return { id: c.id ?? `tc-${messages.length}-${ci}`, name: c.name ?? "tool", args, status: "completed" };
      });
      const turn = typeof d.turn === "number" ? d.turn : -1;
      if (turn >= 0) {
        if (turnAcc && turnAcc.turn !== turn) flushTurn();
        if (!turnAcc) turnAcc = { turn, text: "", thinking: "", toolCalls: [] };
        turnAcc.text += text2;
        turnAcc.thinking += thinking;
        turnAcc.toolCalls.push(...toolCalls);
      } else if (text2 || thinking || toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          text: text2,
          ...thinking ? { thinking } : {},
          ...toolCalls.length > 0 ? { toolCalls } : {}
        });
      }
    } else if (ev.type === "compaction/summary") {
      flushTurn();
      const seqs = d.shadowedSeqs;
      const count = Array.isArray(seqs) ? seqs.length : 0;
      const tokens = typeof d.shadowedTokenCount === "number" ? d.shadowedTokenCount : 0;
      const summary = (d.summary ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      messages.push({ role: "system", text: "", compaction: { count, tokens, ...summary ? { summary } : {} } });
    }
  }
  flushTurn();
  return messages;
}
function readSessionHistory(sessionRoot, dshId) {
  const dir = sessionDir(sessionRoot, dshId);
  if (!dir) {
    logDebug("no session dir for %s", dshId);
    return [];
  }
  const text = readSessionText(dir);
  if (!text) return [];
  const messages = parseSessionLog(text);
  log("history: %s \u922B?%d messages", dshId, messages.length);
  return messages;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  parseSessionLog,
  readSessionHistory
});
