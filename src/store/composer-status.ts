/**
 * composer-status - Composer 状态聚合层共享类型
 *
 * StatusStack 按固定顺序渲染分组：
 *   goal -> todo -> subagent -> background -> preview -> queue
 *
 * 每个 Panel（QueuePanel / TodoPanel / …）自管数据 store，
 * 无数据时返回 null，StatusStack 自动收起。
 */

// ----------------------------------------------------------------
// 状态类型（固定渲染顺序）
// ----------------------------------------------------------------

export type StatusType =
  | "goal"
  | "todo"
  | "subagent"
  | "background"
  | "preview"
  | "queue";

export const TYPE_ORDER: StatusType[] = [
  "goal",
  "todo",
  "subagent",
  "background",
  "preview",
  "queue",
];

export const TYPE_META: Record<StatusType, { label: string }> = {
  goal: { label: "目标" },
  todo: { label: "待办" },
  subagent: { label: "子代理" },
  background: { label: "后台" },
  preview: { label: "预览" },
  queue: { label: "排队" },
};

// ----------------------------------------------------------------
// 条目状态（决定 leading glyph）
// ----------------------------------------------------------------

export type ItemState =
  | "running"
  | "completed"
  | "error"
  | "warning"
  | "pending"
  | "paused"
  | "cancelled"
  | "idle";
