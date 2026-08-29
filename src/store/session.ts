/**
 * session - 会话 ID 管理 + per-session 数据隔离工具
 *
 * 使用 nanostores 的 Map<sessionId, T> 模式，
 * 让队列 / Todo / Goal 等状态按会话隔离。
 */

import { atom } from "nanostores";

/** 当前活跃会话 ID（暂为单一 "default" 会话） */
export const $activeSessionId = atom<string>("default");

export function setActiveSession(id: string) {
  $activeSessionId.set(id);
}

// ----------------------------------------------------------------
// Per-session Map atom 工具
// ----------------------------------------------------------------

export type SessionMapAtom<T> = ReturnType<typeof atom<Map<string, T>>>;

/** 创建一个 per-session Map atom */
export function makeSessionMap<T>(): SessionMapAtom<T> {
  return atom(new Map<string, T>());
}

/** 读取指定会话的数据（不存在则返回默认值） */
export function getSessionData<T>(
  store: SessionMapAtom<T>,
  sessionId: string,
  defaultValue: T,
): T {
  return store.get().get(sessionId) ?? defaultValue;
}

/** 写入指定会话的数据 */
export function setSessionData<T>(
  store: SessionMapAtom<T>,
  sessionId: string,
  value: T,
): void {
  const map = new Map(store.get());
  map.set(sessionId, value);
  store.set(map);
}

/** 函数式更新指定会话的数据 */
export function updateSessionData<T>(
  store: SessionMapAtom<T>,
  sessionId: string,
  updater: (prev: T) => T,
  defaultValue: T,
): void {
  const prev = getSessionData(store, sessionId, defaultValue);
  setSessionData(store, sessionId, updater(prev));
}
