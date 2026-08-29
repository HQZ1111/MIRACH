/**
 * todos - 待办列表 store
 *
 * 由 todo 工具事件驱动，按会话隔离。
 * 四态：pending / in_progress / completed / cancelled
 * 全部完成 4 秒后自动消失（FINISHED_LINGER_MS）。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  updateSessionData,
  setSessionData,
} from "./session";

// ----------------------------------------------------------------
// 类型
// ----------------------------------------------------------------

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  createdAt: number;
}

interface TodoState {
  items: TodoItem[];
  /** 全部完成的时间戳（用于自动消失计时） */
  allDoneAt?: number;
}

const DEFAULT_STATE: TodoState = { items: [] };

/** 全部完成后停留时间 */
export const FINISHED_LINGER_MS = 4000;

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

const $todoMap = makeSessionMap<TodoState>();

/** 当前活跃会话的 todo 状态 */
export const $todosState = computed(
  [$activeSessionId, $todoMap],
  (sessionId, map) => map.get(sessionId) ?? DEFAULT_STATE,
);

/** 完成计数 */
export const $todoCount = computed($todosState, (s) => ({
  done: s.items.filter((i) => i.status === "completed" || i.status === "cancelled").length,
  total: s.items.length,
}));

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

let idSeq = 0;

export function addTodo(content: string): string {
  const sessionId = $activeSessionId.get();
  const item: TodoItem = {
    id: `t${Date.now()}_${idSeq++}`,
    content,
    status: "pending",
    createdAt: Date.now(),
  };
  updateSessionData(
    $todoMap,
    sessionId,
    (prev) => {
      const items = [...prev.items, item];
      return { items, allDoneAt: checkAllDone(items) ? Date.now() : undefined };
    },
    DEFAULT_STATE,
  );
  return item.id;
}

export function updateTodoStatus(id: string, status: TodoStatus): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $todoMap,
    sessionId,
    (prev) => {
      const items = prev.items.map((i) => (i.id === id ? { ...i, status } : i));
      return { items, allDoneAt: checkAllDone(items) ? Date.now() : undefined };
    },
    DEFAULT_STATE,
  );
}

export function removeTodo(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $todoMap,
    sessionId,
    (prev) => {
      const items = prev.items.filter((i) => i.id !== id);
      return { items, allDoneAt: checkAllDone(items) ? Date.now() : undefined };
    },
    DEFAULT_STATE,
  );
}

export function clearTodos(): void {
  const sessionId = $activeSessionId.get();
  setSessionData($todoMap, sessionId, DEFAULT_STATE);
}

// ----------------------------------------------------------------
// 内部工具
// ----------------------------------------------------------------

function checkAllDone(items: TodoItem[]): boolean {
  return (
    items.length > 0 &&
    items.every((i) => i.status === "completed" || i.status === "cancelled")
  );
}
