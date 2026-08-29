/**
 * useTodoAutoDismiss - Todo 全部完成后自动消失
 *
 * 全部完成（或取消）4 秒后清空列表。
 * 在 MainPanel 中调用。
 */

import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { $todosState, clearTodos, FINISHED_LINGER_MS } from "@/store/todos";

export function useTodoAutoDismiss() {
  const { allDoneAt } = useStore($todosState);

  useEffect(() => {
    if (!allDoneAt) return;
    const remaining = FINISHED_LINGER_MS - (Date.now() - allDoneAt);
    const delay = Math.max(0, remaining);
    const timer = window.setTimeout(() => clearTodos(), delay);
    return () => window.clearTimeout(timer);
  }, [allDoneAt]);
}
