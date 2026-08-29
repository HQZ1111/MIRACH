/**
 * ToolTicker - 单行滚动窗口
 *
 * 新工具调用把旧的顶上去，N 个操作只占一行。
 * 每个工具显示为紧凑 chip：[icon] title
 */

import {
  FileEdit,
  Search,
  SquareTerminal,
  Users,
  Wrench,
  Check,
  AlertCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCall, ToolCallCategory, ToolCallStatus } from "@/store/tool-calls";

const CATEGORY_ICONS: Record<ToolCallCategory, LucideIcon> = {
  edit: FileEdit,
  explore: Search,
  run: SquareTerminal,
  delegate: Users,
  other: Wrench,
};

function StatusDot({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-500" />;
    case "completed":
      return <Check className="h-2.5 w-2.5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-2.5 w-2.5 text-red-500" />;
    case "warning":
      return <AlertCircle className="h-2.5 w-2.5 text-amber-500" />;
  }
}

export function ToolTicker({
  calls,
  maxVisible = 5,
}: {
  calls: ToolCall[];
  maxVisible?: number;
}) {
  if (calls.length === 0) return null;
  const recent = calls.slice(-maxVisible);
  const overflow = calls.length - recent.length;

  return (
    <div className="flex items-center gap-2 overflow-hidden px-1 py-0.5">
      {overflow > 0 && (
        <span className="shrink-0 text-[11px] text-muted-foreground/50">
          +{overflow}
        </span>
      )}
      {recent.map((call) => {
        const Icon = CATEGORY_ICONS[call.category];
        return (
          <span
            key={call.id}
            className="flex shrink-0 items-center gap-1 rounded bg-muted/40 px-1.5 py-0.5"
          >
            <StatusDot status={call.status} />
            <Icon className="h-3 w-3 text-muted-foreground" strokeWidth={2} />
            <span className={cn("max-w-[120px] truncate text-[11px] text-muted-foreground")}>
              {call.title}
            </span>
          </span>
        );
      })}
    </div>
  );
}
