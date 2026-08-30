/**
 * Mirach agent-sidecar — dsh 会话历史读取
 *
 * dsh 会话持久化在 DSH_SESSION_ROOT/<cwd编码>/<sessionId>/ 下：
 *   session.jsonl.zstd（多帧 zstd：运行时每次写入一个独立帧）或 session.jsonl（明文）。
 * 本模块把日志解析成前端可回放的 {role, text, thinking} 列表：
 *   - user/message    → 用户消息
 *   - assistant/message → 助手消息（content 里 reasoning 与 text 分离）
 * 并提供 readSessionRawEvents：原始事件序列（含打包 chunk 行解包），
 * 供官方装配层/投影在前端重建统计。
 * 幂等：日志里可能重复的 enqueue 回执（agent/inbox/spliced）不参与，只取 surfaceOp 落地事件。
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { log, logDebug, logWarn } from "./protocol.js";
import { decodeStorageRecord } from "./chunk-rows.js";

export interface HistoryToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "completed";
}

export interface HistoryCompaction {
  count: number;
  tokens: number;
  summary?: string;
}

export interface HistoryMessage {
  role: "user" | "assistant" | "system";
  text: string;
  thinking?: string;
  /** assistant/message content 里的 tool-call 块（dsh 风格工具行回放） */
  toolCalls?: HistoryToolCall[];
  /** compaction/summary 事件（dsh 风格压缩标记回放） */
  compaction?: HistoryCompaction;
}

/** 查找指定 dsh session id 的持久化目录（先精确匹配目录名，再递归找 session.jsonl*）。 */
function sessionDir(sessionRoot: string, dshId: string): string | null {
  if (!existsSync(sessionRoot)) return null;
  const walk = (dir: string, depth: number): string | null => {
    let found: string | null = null;
    try {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (found) break;
        if (name.isDirectory()) {
          if (name.name === dshId) {
            // 确认里面有会话日志文件
            const logFile = join(dir, name.name, "session.jsonl.zstd");
            const plain = join(dir, name.name, "session.jsonl");
            if (existsSync(logFile) || existsSync(plain)) return join(dir, name.name);
          } else if (depth < 2) {
            found = walk(join(dir, name.name), depth + 1);
          }
        }
      }
    } catch {
      /* 权限/IO 错误忽略 */
    }
    return found;
  };
  return walk(sessionRoot, 0);
}

/** 解压会话日志（多帧 zstd 或明文 JSONL）。 */
function readSessionText(dir: string): string {
  const zstdPath = join(dir, "session.jsonl.zstd");
  if (existsSync(zstdPath)) {
    const buf = readFileSync(zstdPath);
    // 多帧 zstd：按 magic 28 B5 2F FD 切帧逐个解压
    const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    const frames: number[] = [];
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
        all += zstdDecompressSync(frame).toString("utf8");
      } catch (err) {
        logDebug("zstd frame %d decode failed: %s", i, err instanceof Error ? err.message : String(err));
      }
    }
    if (all) return all;
    // 兜底：单帧流式解压
    logWarn("multi-frame decode empty for %s — trying stream decode", dir);
    return readStreamingZstd(buf);
  }
  const plain = join(dir, "session.jsonl");
  return existsSync(plain) ? readFileSync(plain, "utf8") : "";
}

function readStreamingZstd(buf: Buffer): string {
  try {
    const z = require("node:zlib") as typeof import("node:zlib");
    const dec = z.createZstdDecompress();
    const chunks: Buffer[] = [];
    dec.on("data", (c: Buffer) => chunks.push(c));
    // 同步跑完流（小文件）
    dec.end(buf);
    // createZstdDecompress 是异步流；这里用同步解压兜底
    return z.zstdDecompressSync(buf).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * 解析会话日志 → 消息列表（按事件顺序）。
 * user/message（surfaceOp=append）→ 用户消息；assistant/message → 助手消息；
 * 同一 turn 内的多条 assistant/message 合并为一条（引擎落盘时每个工具回合
 * 一条 AM：bash 一步一条、最终文本一条——若不合并，回放就是"每个工具一条
 * 独立消息"，与实时流式显示（工具挂同一条 AI 消息）不一致）。
 * content 里 reasoning/text/tool-call 分块；compaction/summary → 压缩标记。
 */
export function parseSessionLog(text: string): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  // 工具调用 fallback id：独立递增（合并缓冲下 messages.length 不变，
  // 用它做序号会让同消息多个工具 id 重复 → store 按 id 合并成一条）
  let tcCounter = 0;
  // 按 turn 合并的待输出 buffer（一个 AI 回合 = 若干 AM；合并后输出一条）
  let turnAcc: { turn: number; text: string; thinking: string; toolCalls: HistoryToolCall[] } | null = null;
  const flushTurn = () => {
    if (!turnAcc) return;
    const merged: HistoryMessage = {
      role: "assistant",
      text: turnAcc.text,
      ...(turnAcc.thinking ? { thinking: turnAcc.thinking } : {}),
      ...(turnAcc.toolCalls.length > 0 ? { toolCalls: turnAcc.toolCalls } : {}),
    };
    // 纯工具回合（无正文）也输出（前端只 DshToolRow 渲染工具行）
    if (turnAcc.text || turnAcc.thinking || turnAcc.toolCalls.length > 0) messages.push(merged);
    turnAcc = null;
  };
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let ev: { type?: string; data?: Record<string, unknown>; surfaceOp?: unknown };
    try {
      ev = JSON.parse(line) as { type?: string; data?: Record<string, unknown>; surfaceOp?: unknown };
    } catch {
      continue;
    }
    const d = (ev.data ?? {}) as {
      role?: string;
      turn?: number;
      content?: { type?: string; text?: string; id?: string; name?: string; arguments?: string }[];
      surfaceOp?: { op?: string };
      message?: { role?: string; content?: { type?: string; text?: string; id?: string; name?: string; arguments?: string }[] };
      shadowedSeqs?: unknown[];
      shadowedTokenCount?: number;
      summary?: { type?: string; text?: string }[];
    };
    if (ev.type === "user/message" && d.role === "user") {
      // 跳过压缩 checkpoint（surfaceOp={op:'replace'}）；普通追加是顶层字符串 "append"
      const so = ev.surfaceOp as unknown;
      const isReplace =
        so === "replace" ||
        (typeof so === "object" && so !== null && (so as { op?: string }).op === "replace");
      const text = (d.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      // time-context 每步时间采样注入（写给模型感知时间流逝）不属于用户对话，回放时过滤
      const isTimeContext = /^Time sampled while preparing turn \d+, step \d+:/m.test(text);
      if (isReplace) continue;
      if (text.startsWith("Current runtime context.")) continue; // 引擎 runtime-context 快照，回放过滤
      if (isTimeContext) continue;
      // 只有真实用户消息才终结进行中的 AI 回合（time-context/replace 等注入
      // 也是 user/message 事件，若在此前 flush 会把同回合的多条 AM 拆散）
      flushTurn();
      if (text) messages.push({ role: "user", text });
    } else if (ev.type === "assistant/message" && d.message?.role === "assistant") {
      const parts = d.message.content ?? [];
      const text = parts.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      const thinking = parts.filter((c) => c.type === "reasoning").map((c) => c.text ?? "").join("");
      const toolCalls: HistoryToolCall[] = parts
        .filter((c) => c.type === "tool-call")
        .map((c, ci) => {
          let args: Record<string, unknown> = {};
          if (c.arguments) {
            try {
              const v = JSON.parse(c.arguments);
              if (v && typeof v === "object") args = v as Record<string, unknown>;
            } catch {
              args = { raw: c.arguments };
            }
          }
          return { id: c.id ?? `tc-${tcCounter++}`, name: c.name ?? "tool", args, status: "completed" as const };
        });
      const turn = typeof d.turn === "number" ? d.turn : -1;
      if (turn >= 0) {
        // 同一回合：并入缓冲；换回合：先落地
        if (turnAcc && turnAcc.turn !== turn) flushTurn();
        if (!turnAcc) turnAcc = { turn, text: "", thinking: "", toolCalls: [] };
        turnAcc.text += text;
        turnAcc.thinking += thinking;
        turnAcc.toolCalls.push(...toolCalls);
      } else if (text || thinking || toolCalls.length > 0) {
        // 无 turn 字段（兼容旧日志）：原样输出
        messages.push({
          role: "assistant",
          text,
          ...(thinking ? { thinking } : {}),
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        });
      }
    } else if (ev.type === "compaction/summary") {
      flushTurn();
      const seqs = d.shadowedSeqs;
      const count = Array.isArray(seqs) ? seqs.length : 0;
      const tokens = typeof d.shadowedTokenCount === "number" ? d.shadowedTokenCount : 0;
      const summary = (d.summary ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
      messages.push({ role: "system", text: "", compaction: { count, tokens, ...(summary ? { summary } : {}) } });
    }
  }
  flushTurn();
  return messages;
}

/** 读取指定 dsh 会话的历史消息（找不到/无内容返回空数组）。 */
export function readSessionHistory(sessionRoot: string, dshId: string): HistoryMessage[] {
  const dir = sessionDir(sessionRoot, dshId);
  if (!dir) {
    logDebug("no session dir for %s", dshId);
    return [];
  }
  const text = readSessionText(dir);
  if (!text) return [];
  const messages = parseSessionLog(text);
  log("history: %s → %d messages", dshId, messages.length);
  return messages;
}

/** 历史原始事件（get_history 附带；官方装配层/投影的事件底座）。 */
export interface RawHistoryEvent {
  seq: number;
  time: number;
  type: string;
  data: unknown;
  /** surfaceOp/sourceEventSeqs 等信封字段原样保留（投影 surface 判定需要） */
  [key: string]: unknown;
}

/** 历史事件上限：超出截断最旧段（超大日志的负载保护；投影按累计语义不受缺前缀影响，仅时间线窗口变短） */
const MAX_HISTORY_EVENTS = 20000;

/**
 * 读取指定 dsh 会话的原始事件序列（含打包 chunk 行解包，seq/time 精确）。
 * 与 readSessionHistory 同源同日志；坏行逐行 try/catch 跳过——历史回放
 * 宁可短一行不可整段失败。
 */
export function readSessionRawEvents(sessionRoot: string, dshId: string): RawHistoryEvent[] {
  const dir = sessionDir(sessionRoot, dshId);
  if (!dir) return [];
  const text = readSessionText(dir);
  if (!text) return [];
  const events: RawHistoryEvent[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    try {
      for (const ev of decodeStorageRecord(parsed)) {
        events.push(ev as RawHistoryEvent);
      }
    } catch (err) {
      logDebug("history raw line decode failed: %s", err instanceof Error ? err.message : String(err));
    }
  }
  if (events.length > MAX_HISTORY_EVENTS) return events.slice(-MAX_HISTORY_EVENTS);
  return events;
}
