/**
 * BranchPicker - 消息分支选择器
 *
 * N/M + 左右箭头，切换消息分支。
 * 只有多于 1 个分支时显示。
 */

import { ChevronLeft, ChevronRight, GitFork } from "lucide-react";

export function BranchPicker({
  current,
  total,
  onBranchChange,
}: {
  current: number;
  total: number;
  onBranchChange?: (dir: "prev" | "next") => void;
}) {
  if (total <= 1) return null;

  return (
    <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground">
      <GitFork className="h-3 w-3" strokeWidth={2} />
      <button
        onClick={() => onBranchChange?.("prev")}
        disabled={current <= 1}
        className="rounded p-0.5 transition-colors hover:bg-muted disabled:opacity-30"
      >
        <ChevronLeft className="h-3 w-3" />
      </button>
      <span>
        {current}/{total}
      </span>
      <button
        onClick={() => onBranchChange?.("next")}
        disabled={current >= total}
        className="rounded p-0.5 transition-colors hover:bg-muted disabled:opacity-30"
      >
        <ChevronRight className="h-3 w-3" />
      </button>
    </div>
  );
}
