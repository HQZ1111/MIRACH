/**
 * session-events — 原始 dsh SessionEvent 日志（按 seq）
 *
 * 官方装配层（ConversationLocationIndex 等）的事件底座：实时 raw_session_event
 * 透传 + 历史回放事件（sidecar get_history 附带，含 chunk-row 解包）统一落在
 * 这里。按 seq 排序去重，容量上限环形裁剪。
 * 裁剪只影响时间线窗口；投影折叠（dsh-assembly）按水位增量累计，
 * 不受环裁剪影响（整会话累计值不丢）。
 */
import { atom } from "nanostores";
import { ingestAssemblyEvents, resetAssembly } from "@/dsh-assembly/store";

export interface RawSessionEvent {
  seq: number;
  type: string;
  data: unknown;
  /** 事件时间（epoch ms；实时透传与历史解包都有，缺省 0） */
  time: number;
}

const MAX_EVENTS = 6000;

export const $rawEvents = atom<RawSessionEvent[]>([]);

/** 按 seq 追加/去重（历史回放与实时流可能重叠，seq 单调去重）并喂装配引擎 */
export function pushRawEvent(seq: number, type: string, data: unknown, time = 0): void {
  if (!Number.isSafeInteger(seq) || seq < 0) return;
  const list = $rawEvents.get();
  if (list.some((e) => e.seq === seq)) return;
  const next = [...list, { seq, type, data, time }].sort((a, b) => a.seq - b.seq).slice(-MAX_EVENTS);
  $rawEvents.set(next);
  ingestAssemblyEvents(next);
}

/** 历史回放批量摄入（get_history 附带 events；一次性 O(n) 去重） */
export function pushRawEvents(events: { seq: number; type: string; data: unknown; time?: number }[]): void {
  if (events.length === 0) return;
  const list = $rawEvents.get();
  const seen = new Set(list.map((e) => e.seq));
  const merged = [...list];
  for (const ev of events) {
    if (!Number.isSafeInteger(ev?.seq) || seen.has(ev.seq)) continue;
    seen.add(ev.seq);
    merged.push({ seq: ev.seq, type: ev.type, data: ev.data, time: ev.time ?? 0 });
  }
  if (merged.length === list.length) return;
  merged.sort((a, b) => a.seq - b.seq);
  const next = merged.slice(-MAX_EVENTS);
  $rawEvents.set(next);
  ingestAssemblyEvents(next);
}

/** 会话切换/清空时复位（原始日志 + 装配引擎/投影一起） */
export function resetRawEvents(): void {
  $rawEvents.set([]);
  resetAssembly();
}
