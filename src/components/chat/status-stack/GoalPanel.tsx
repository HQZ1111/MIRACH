/**
 * GoalPanel - 目标状态行
 *
 * 单行展示当前目标，状态决定图标颜色和副标题：
 *   active  -> spinner + "目标进行中"
 *   done    -> 绿勾 + "目标完成"
 *   paused  -> 暂停 + "目标已暂停"
 *   waiting -> 警告 + "等待确认"
 */

import { useStore } from "@nanostores/react";
import { Target } from "lucide-react";
import { $goalState, type GoalStatus } from "@/store/goals";
import type { ItemState } from "@/store/composer-status";
import { StatusRow } from "./StatusRow";

const GOAL_LABELS: Record<GoalStatus, string> = {
  idle: "",
  active: "目标进行中",
  done: "目标完成",
  paused: "目标已暂停",
  waiting: "等待确认",
};

function goalToItemState(status: GoalStatus): ItemState {
  switch (status) {
    case "active":
      return "running";
    case "done":
      return "completed";
    case "paused":
      return "paused";
    case "waiting":
      return "warning";
    default:
      return "idle";
  }
}

export function GoalPanel() {
  const goal = useStore($goalState);

  if (goal.status === "idle" || !goal.text) return null;

  return (
    <StatusRow
      state={goalToItemState(goal.status)}
      title={goal.text}
      subtitle={GOAL_LABELS[goal.status]}
      icon={<Target className="h-3.5 w-3.5 text-muted-foreground" />}
    />
  );
}
