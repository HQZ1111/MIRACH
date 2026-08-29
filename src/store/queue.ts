/**
 * queue - 对话排队系统
 *
 * Agent 忙时用户可继续输入，消息进入排队队列。
 * 空闲后自动排空（auto-drain），或用户手动发送/编辑/删除。
 *
 * 停车(Park)：Stop/Esc 时暂停队列，显示 Resume 按钮直到手动恢复。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  getSessionData,
  setSessionData,
  updateSessionData,
} from "./session";
import { $agentBusy } from "./agent";

// ----------------------------------------------------------------
// 类型
// ----------------------------------------------------------------

export interface QueuedPrompt {
  id: string;
  text: string;
  /** 展开后的显示文本（如 /skill 展开为调用名） */
  displayText?: string;
  queuedAt: number;
}

interface QueueState {
  items: QueuedPrompt[];
  parked: boolean;
}

const DEFAULT_STATE: QueueState = { items: [], parked: false };

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

const $queueMap = makeSessionMap<QueueState>();

/** 当前活跃会话的队列状态 */
export const $queueState = computed(
  [$activeSessionId, $queueMap],
  (sessionId, map) => map.get(sessionId) ?? DEFAULT_STATE,
);

/** 队列条目数 */
export const $queueCount = computed($queueState, (s) => s.items.length);

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

let idSeq = 0;

/** 入队一条消息 */
export function enqueue(text: string, displayText?: string): string {
  const sessionId = $activeSessionId.get();
  const item: QueuedPrompt = {
    id: `q${Date.now()}_${idSeq++}`,
    text,
    displayText,
    queuedAt: Date.now(),
  };
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => ({ ...prev, items: [...prev.items, item] }),
    DEFAULT_STATE,
  );
  return item.id;
}

/** 删除一条排队消息 */
export function removeQueued(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => ({ ...prev, items: prev.items.filter((i) => i.id !== id) }),
    DEFAULT_STATE,
  );
}

/** 编辑一条排队消息的文本 */
export function updateQueuedText(id: string, text: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => ({
      ...prev,
      items: prev.items.map((i) => (i.id === id ? { ...i, text } : i)),
    }),
    DEFAULT_STATE,
  );
}

/** 停车：暂停 auto-drain */
export function parkQueuedPrompts(): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => ({ ...prev, parked: true }),
    DEFAULT_STATE,
  );
}

/** 恢复：取消停车 */
export function resumeQueuedPrompts(): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => ({ ...prev, parked: false }),
    DEFAULT_STATE,
  );
}

/** 提升到队首 + 取消停车（用于"立即发送"） */
export function promoteQueued(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $queueMap,
    sessionId,
    (prev) => {
      const item = prev.items.find((i) => i.id === id);
      if (!item) return prev;
      return {
        items: [item, ...prev.items.filter((i) => i.id !== id)],
        parked: false,
      };
    },
    DEFAULT_STATE,
  );
}

/** 弹出队首（auto-drain / 手动排空调用） */
export function drainFirst(): QueuedPrompt | null {
  const sessionId = $activeSessionId.get();
  const state = getSessionData($queueMap, sessionId, DEFAULT_STATE);
  if (state.items.length === 0) return null;
  const [first, ...rest] = state.items;
  setSessionData($queueMap, sessionId, { ...state, items: rest });
  return first;
}

/** 是否应该自动排空 */
export function shouldAutoDrain(): boolean {
  const sessionId = $activeSessionId.get();
  const state = getSessionData($queueMap, sessionId, DEFAULT_STATE);
  return state.items.length > 0 && !state.parked && !$agentBusy.get();
}
