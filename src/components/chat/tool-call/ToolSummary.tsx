/**
 * ToolSummary - 工具调用一行摘要
 *
 * 把多条工具调用压缩成一行：
 *   "Edited 3 files, ran 5 commands"
 */

import { summarizeToolRun } from "@/lib/tool-summary";
import type { ToolCall } from "@/store/tool-calls";

export function ToolSummary({
  calls,
  live = false,
}: {
  calls: ToolCall[];
  live?: boolean;
}) {
  const summary = summarizeToolRun(calls, live);
  if (!summary) return null;

  return (
    <div className="flex items-center gap-1.5 px-1 py-0.5 text-body-sm text-muted-foreground">
      <span>{summary}</span>
    </div>
  );
}
