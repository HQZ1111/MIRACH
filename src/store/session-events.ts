/**
 * session-events — 原始 dsh SessionEvent 日志（按 seq）
 *
 * 官方装配层（ConversationLocationIndex 等）的事件底座：实时 raw_session_event
 * 透传 + 历史回放事件统一落在这里。按 seq 排序去重，容量上限环形裁剪。
 */
import { atom } from "nanostores";

export interface RawSessionEvent {
  seq: number;
  type: string;
  data: unknown;
}

const MAX_EVENTS = 6000;

export const $rawEvents = atom<RawSessionEvent[]>([]);

/** 按 seq 追加/去重（历史回放与实时流可能重叠，seq 单调去重） */
export function pushRawEvent(seq: number, type: string, data: unknown): void {
  const list = $rawEvents.get();
  if (list.some((e) => e.seq === seq)) return;
  const next = [...list, { seq, type, data }].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
  $rawEvents.set(next);
}

/** 会话切换/清空时复位 */
export function resetRawEvents(): void {
  $rawEvents.set([]);
}
