/**
 * session-events — 原始 dsh SessionEvent 日志（按会话 + seq）
 *
 * 官方装配层（ConversationLocationIndex 等）的事件底座：实时 raw_session_event
 * 透传 + 历史回放事件（sidecar get_history 附带，含 chunk-row 解包）统一落在
 * 这里。按 (sessionId, seq) 排序去重，容量上限环形裁剪。
 *
 * 会话归属是硬约束：引擎 seq 是每会话单调的，两个会话的 seq 会重叠，只按 seq
 * 去重会让 A 会话的事件挤掉 B 会话的同 seq 事件（跨会话串台）。首个 push 确定
 * 归属，之后其他会话的事件一律丢弃；切换会话必须先 resetRawEvents(newId)。
 *
 * 裁剪只影响时间线窗口；投影折叠（dsh-assembly）按水位增量累计，
 * 不受环裁剪影响（整会话累计值不丢）。
 */
import { atom } from "nanostores";
import { ingestAssemblyEvents, resetAssembly } from "@/dsh-assembly/store";

export interface RawSessionEvent {
  /** 归属会话（前端会话 id；实时流与历史回放用同一 id 空间） */
  sessionId: string;
  seq: number;
  type: string;
  data: unknown;
  /** 事件时间（epoch ms；实时透传与历史解包都有，缺省 0） */
  time: number;
}

const MAX_EVENTS = 6000;

export const $rawEvents = atom<RawSessionEvent[]>([]);
/** 当前原始日志归属的会话 id（null = 空，等待首个 push 确定）。 */
export const $rawSessionId = atom<string | null>(null);

/** 归属校验：首个非空会话确定归属，之后只接受同会话事件。 */
function acceptSession(sessionId: string): boolean {
  if (!sessionId) return false;
  const cur = $rawSessionId.get();
  if (cur === null) {
    $rawSessionId.set(sessionId);
    return true;
  }
  return cur === sessionId;
}

/** 按 (sessionId, seq) 追加/去重并喂装配引擎。 */
export function pushRawEvent(sessionId: string, seq: number, type: string, data: unknown, time = 0): void {
  if (!Number.isSafeInteger(seq) || seq < 0) return;
  if (!acceptSession(sessionId)) return;
  const list = $rawEvents.get();
  if (list.some((e) => e.seq === seq)) return;
  const next = [...list, { sessionId, seq, type, data, time }].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
  $rawEvents.set(next);
  ingestAssemblyEvents(next, sessionId);
}

/** 历史回放批量摄入（get_history 附带 events；一次性 O(n) 去重）。 */
export function pushRawEvents(
  sessionId: string,
  events: { seq: number; type: string; data: unknown; time?: number }[],
): void {
  if (events.length === 0) return;
  if (!acceptSession(sessionId)) return;
  const list = $rawEvents.get();
  const seen = new Set(list.map((e) => e.seq));
  const merged = [...list];
  for (const ev of events) {
    if (!Number.isSafeInteger(ev?.seq) || seen.has(ev.seq)) continue;
    seen.add(ev.seq);
    merged.push({ sessionId, seq: ev.seq, type: ev.type, data: ev.data, time: ev.time ?? 0 });
  }
  if (merged.length === list.length) return;
  merged.sort((a, b) => a.seq - b.seq);
  const next = merged.slice(-MAX_EVENTS);
  $rawEvents.set(next);
  ingestAssemblyEvents(next, sessionId);
}

/**
 * 复位（切换/清空会话时调用）：原始日志 + 归属会话 + 装配引擎/投影一起。
 * @param sessionId - 切换后的新会话 id（null = 完全清空，归属待下一个 push 确定）
 */
export function resetRawEvents(sessionId: string | null = null): void {
  $rawEvents.set([]);
  $rawSessionId.set(sessionId);
  resetAssembly();
}
