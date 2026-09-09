/**
 * Mirach agent-sidecar — dsh 会话历史读取
 *
 * 底层全部走官方 `@deepseek-ai/dsh-session-persistence-jsonl`（session-store.ts 承载）：
 *   - 会话目录定位/列举 → 官方 list()/requireStoredLog（跨 cwd、旧命名 v0 兼容）
 *   - 多帧 zstd 切帧解压 → 官方 readZstdPrefix
 *   - 打包 chunk 行展开 → 官方 session-format-catalog restore（v0→v3 迁移）
 * 本模块只保留 mirach 的消息折叠规则：
 *   - user/message    → 用户消息
 *   - assistant/message → 助手消息（content 里 reasoning 与 text 分离；同 turn 合并）
 *   - compaction/summary → 压缩标记
 * 幂等：日志里重复的 enqueue 回执（agent/inbox/spliced）不参与，只取 surfaceOp 落地事件。
 */

import { log, logDebug } from "./protocol.js";
import { listSessionArtifacts, readSessionArtifact, type SessionArtifactSnapshot } from "./session-store.js";

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

/**
 * 解析官方展开后的会话事件序列 → 消息列表（按事件顺序）。
 * 同一 turn 内的多条 assistant/message 合并为一条（引擎落盘时每个工具回合
 * 一条 AM：bash 一步一条、最终文本一条——若不合并，回放就是"每个工具一条
 * 独立消息"，与实时流式显示（工具挂同一条 AI 消息）不一致）。
 */
export function parseSessionEvents(events: RawHistoryEvent[]): HistoryMessage[] {
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
  for (const ev of events) {
    const d = (ev.data ?? {}) as {
      role?: string;
      turn?: number;
      content?: { type?: string; text?: string; id?: string; name?: string; arguments?: string }[];
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
        .map((c) => {
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
export async function readSessionHistory(sessionRoot: string, dshId: string): Promise<HistoryMessage[]> {
  const artifact = await readSessionArtifact(dshId);
  if (!artifact || artifact.events.length === 0) {
    logDebug("no session artifact for %s", dshId);
    return [];
  }
  const messages = parseSessionEvents(artifact.events as RawHistoryEvent[]);
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
 * 读取指定 dsh 会话的原始事件序列（官方 restore 管道：chunk 已展开、seq/time 精确）。
 * 官方管道整体失败时返回空数组——历史回放宁可短不可失败。
 */
export async function readSessionRawEvents(sessionRoot: string, dshId: string): Promise<RawHistoryEvent[]> {
  const artifact = await readSessionArtifact(dshId);
  if (!artifact || artifact.events.length === 0) return [];
  const events = artifact.events as RawHistoryEvent[];
  if (events.length > MAX_HISTORY_EVENTS) return events.slice(-MAX_HISTORY_EVENTS);
  return events;
}

/** 会话列举（官方 list() 直通；index.ts 的 list_sessions 消费）。 */
export async function listAllSessions(): Promise<SessionArtifactSnapshot[] | null> {
  return await listSessionArtifacts();
}
