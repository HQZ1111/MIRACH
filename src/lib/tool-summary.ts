/**
 * tool-summary - 工具调用一行摘要
 *
 * 把一串工具调用压缩成一行：
 *   "Edited 3 files, ran 5 commands, explored 2 paths"
 * live=true 时用进行时："Editing 3 files..."
 */

import type { ToolCall, ToolCallCategory } from "@/store/tool-calls";

const CATEGORY_VERBS: Record<
  ToolCallCategory,
  { past: string; present: string; noun: string }
> = {
  edit: { past: "Edited", present: "Editing", noun: "file" },
  explore: { past: "Explored", present: "Exploring", noun: "path" },
  run: { past: "Ran", present: "Running", noun: "command" },
  delegate: { past: "Delegated", present: "Delegating", noun: "task" },
  other: { past: "Processed", present: "Processing", noun: "operation" },
};

const ORDER: ToolCallCategory[] = ["edit", "explore", "run", "delegate", "other"];

export function summarizeToolRun(calls: ToolCall[], live = false): string {
  if (calls.length === 0) return "";

  // 按类别分组
  const byCategory = new Map<ToolCallCategory, ToolCall[]>();
  for (const call of calls) {
    const list = byCategory.get(call.category) ?? [];
    list.push(call);
    byCategory.set(call.category, list);
  }

  // 构建摘要
  const parts: string[] = [];
  for (const cat of ORDER) {
    const list = byCategory.get(cat);
    if (!list || list.length === 0) continue;
    const verbs = CATEGORY_VERBS[cat];
    const verb = live ? verbs.present : verbs.past;

    if (cat === "edit") {
      const files = new Set<string>();
      list.forEach((c) => c.filesChanged?.forEach((f) => files.add(f)));
      const n = files.size || list.length;
      parts.push(`${verb} ${n} ${verbs.noun}${n > 1 ? "s" : ""}`);
    } else {
      const n = list.length;
      parts.push(`${verb} ${n} ${verbs.noun}${n > 1 ? "s" : ""}`);
    }
  }

  return parts.join(", ");
}
