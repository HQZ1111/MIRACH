/**
 * TodoPanel - 待办列表面板
 *
 * 复选框语义：
 *   pending     -> 虚线圆圈
 *   in_progress -> 旋转 spinner
 *   completed   -> 绿勾
 *   cancelled   -> 斜杠
 *
 * 点击行可循环切换状态：pending -> in_progress -> completed -> pending
 */

import { useStore } from "@nanostores/react";
import { ListChecks } from "lucide-react";
import {
  $todosState,
  $todoCount,
  updateTodoStatus,
  type TodoStatus,
} from "@/store/todos";
import type { ItemState } from "@/store/composer-status";
import { StatusSection } from "./StatusSection";
import { StatusRow } from "./StatusRow";

// TodoStatus -> ItemState 映射
function todoToItemState(status: TodoStatus): ItemState {
  switch (status) {
    case "pending":
      return "pending";
    case "in_progress":
      return "running";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}

export function TodoPanel() {
  const { items } = useStore($todosState);
  const { done, total } = useStore($todoCount);

  if (items.length === 0) return null;

  // 点击循环：pending -> in_progress -> completed -> pending
  const cycleStatus = (current: TodoStatus): TodoStatus => {
    switch (current) {
      case "pending":
        return "in_progress";
      case "in_progress":
        return "completed";
      case "completed":
        return "pending";
      case "cancelled":
        return "pending";
    }
  };

  return (
    <StatusSection
      label="待办"
      icon={<ListChecks className="h-3.5 w-3.5 text-muted-foreground" />}
      accessory={`${done}/${total}`}
    >
      {items.map((item) => (
        <StatusRow
          key={item.id}
          state={todoToItemState(item.status)}
          title={item.content}
          onActivate={() => updateTodoStatus(item.id, cycleStatus(item.status))}
        />
      ))}
    </StatusSection>
  );
}
