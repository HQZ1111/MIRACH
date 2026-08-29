/**
 * Hermes agent-sidecar 鈥?dsh 浼氳瘽鍘嗗彶璇诲彇
 *
 * dsh 浼氳瘽鎸佷箙鍖栧湪 DSH_SESSION_ROOT/<cwd缂栫爜>/<sessionId>/ 涓嬶細
 *   session.jsonl.zstd锛堝甯?zstd锛氳繍琛屾椂姣忔鍐欏叆涓€涓嫭绔嬪抚锛夋垨 session.jsonl锛堟槑鏂囷級銆?
 * 鏈ā鍧楁妸鏃ュ織瑙ｆ瀽鎴愬墠绔彲鍥炴斁鐨?{role, text, thinking} 鍒楄〃锛?
 *   - user/message  鈫?鐢ㄦ埛娑堟伅
 *   - assistant/message 鈫?鍔╂墜娑堟伅锛坈ontent 閲?reasoning 涓?text 鍒嗙锛?
 * 骞傜瓑锛氭棩蹇楅噷鍙兘閲嶅鐨?enqueue 鍥炴墽锛坅gent/inbox/spliced锛変笉鍙備笌锛屽彧鍙?surfaceOp 钀藉湴浜嬩欢銆?
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { log, logDebug, logWarn } from "./protocol.js";

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
  /** assistant/message content 閲岀殑 tool-call 鍧楋紙dsh 椋庢牸宸ュ叿琛屽洖鏀撅級 */
  toolCalls?: HistoryToolCall[];
  /** compaction/summary 浜嬩欢锛坉sh 椋庢牸鍘嬬缉鏍囪鍥炴斁锛?*/
  compaction?: HistoryCompaction;
}

/** 鏌ユ壘鎸囧畾 dsh session id 鐨勬寔涔呭寲鐩綍锛堝厛绮剧‘鍖归厤鐩綍鍚嶏紝鍐嶉€掑綊鎵?session.jsonl*锛夈€?*/
function sessionDir(sessionRoot: string, dshId: string): string | null {
  if (!existsSync(sessionRoot)) return null;
  // 鐩存帴鐩綍鍖归厤锛堟甯歌矾寰勶級
  const walk = (dir: string, depth: number): string | null => {
    let found: string | null = null;
    try {
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        if (found) break;
        if (name.isDirectory()) {
          if (name.name === dshId) {
            // 纭閲岄潰鏈変細璇濇棩蹇楁枃浠?
            const logFile = join(dir, name.name, "session.jsonl.zstd");
            const plain = join(dir, name.name, "session.jsonl");
            if (existsSync(logFile) || existsSync(plain)) return join(dir, name.name);
          } else if (depth < 2) {
            found = walk(join(dir, name.name), depth + 1);
          }
        }
      }
    } catch {
      /* 鏉冮檺/IO 閿欒蹇界暐 */
    }
    return found;
  };
  return walk(sessionRoot, 0);
}

/** 瑙ｅ帇浼氳瘽鏃ュ織锛堝甯?zstd 鎴栨槑鏂?JSONL锛夈€?*/
function readSessionText(dir: string): string {
  const zstdPath = join(dir, "session.jsonl.zstd");
  if (existsSync(zstdPath)) {
    const buf = readFileSync(zstdPath);
    // 澶氬抚 zstd锛氭寜 magic 28 B5 2F FD 鍒囧抚閫愪釜瑙ｅ帇
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
    // 鍏滃簳锛氬崟甯ф祦寮忚В鍘?
    logWarn("multi-frame decode empty for %s 鈥?trying stream decode", dir);
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
    // 鍚屾璺戝畬娴侊紙灏忔枃浠讹級
    dec.end(buf);
    // createZstdDecompress 鏄紓姝ユ祦锛涜繖閲岀敤鍚屾瑙ｅ帇鍏滃簳
    return z.zstdDecompressSync(buf).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * 瑙ｆ瀽浼氳瘽鏃ュ織 鈫?娑堟伅鍒楄〃锛堟寜浜嬩欢椤哄簭锛夈€?
 * user/message锛坰urfaceOp=append锛夆啋 鐢ㄦ埛娑堟伅锛沘ssistant/message 鈫?鍔╂墜娑堟伅锛?
 * 涓?*鍚屼竴 turn 鍐呯殑澶氭潯 assistant/message 鍚堝苟涓轰竴鏉?*锛堝紩鎿庤惤鐩樻椂姣忎釜宸ュ叿鍥炲悎
 * 涓€鏉?AM锛歜ash 涓€姝ヤ竴鏉°€佹渶缁堟枃鏈竴鏉♀€斺€旇嫢涓嶅姞鍚堝苟锛屽洖鏀惧氨鏄?姣忎釜宸ュ叿涓€鏉?
 * 鐙珛娑堟伅"锛屼笌瀹炴椂娴佸紡鏄剧ず锛堝伐鍏锋寕鍚屼竴鏉?AI 娑堟伅锛変笉涓€鑷达級銆?
 * content 閲?reasoning/text/tool-call 鍒嗗潡锛沜ompaction/summary 鈫?鍘嬬缉鏍囪銆?
 */
export function parseSessionLog(text: string): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  // 工具调用 fallback id：独立递增（合并缓冲下 messages.length 不变，
  // 用它做序号会让同消息多个工具 id 重复 → store 按 id 合并成一条）
  let tcCounter = 0;
  // 鎸?turn 鍚堝苟鐨勫緟杈撳嚭 buffer锛堜竴涓?AI 鍥炲悎 = 鑻ュ共 AM锛涘悎骞跺悗杈撳嚭涓€鏉★級
  let turnAcc: { turn: number; text: string; thinking: string; toolCalls: HistoryToolCall[] } | null = null;
  const flushTurn = () => {
    if (!turnAcc) return;
    const merged: HistoryMessage = {
      role: "assistant",
      text: turnAcc.text,
      ...(turnAcc.thinking ? { thinking: turnAcc.thinking } : {}),
      ...(turnAcc.toolCalls.length > 0 ? { toolCalls: turnAcc.toolCalls } : {}),
    };
    // 绾伐鍏峰洖鍚堬紙鏃犳鏂囷級涔熻緭鍑猴紙鍓嶇浠?DshToolRow 娓叉煋宸ュ叿琛岋級
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
        // 鍚屼竴鍥炲悎锛氬苟鍏ョ紦鍐诧紱鎹㈠洖鍚堬細鍏堣惤鐩?
        if (turnAcc && turnAcc.turn !== turn) flushTurn();
        if (!turnAcc) turnAcc = { turn, text: "", thinking: "", toolCalls: [] };
        turnAcc.text += text;
        turnAcc.thinking += thinking;
        turnAcc.toolCalls.push(...toolCalls);
      } else if (text || thinking || toolCalls.length > 0) {
        // 鏃?turn 瀛楁锛堝吋瀹规棫鏃ュ織锛夛細鍘熸牱杈撳嚭
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

/** 璇诲彇鎸囧畾 dsh session 鐨勫巻鍙叉秷鎭紙鎵句笉鍒?鏃犲唴瀹硅繑鍥炵┖鏁扮粍锛夈€?*/
export function readSessionHistory(sessionRoot: string, dshId: string): HistoryMessage[] {
  const dir = sessionDir(sessionRoot, dshId);
  if (!dir) {
    logDebug("no session dir for %s", dshId);
    return [];
  }
  const text = readSessionText(dir);
  if (!text) return [];
  const messages = parseSessionLog(text);
  log("history: %s 鈫?%d messages", dshId, messages.length);
  return messages;
}
