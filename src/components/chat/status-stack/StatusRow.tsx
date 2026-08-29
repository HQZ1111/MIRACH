/**
 * StatusRow - 通用状态行
 *
 * 三槽布局：leading glyph / content / trailing actions
 * trailing 在 hover 时显现。
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  [glyph]  title                    [actions] │
 *   │           subtitle                            │
 *   └──────────────────────────────────────────────┘
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Loader2, Check, AlertCircle, CircleSlash, Circle } from "lucide-react";
import type { ItemState } from "@/store/composer-status";

// ----------------------------------------------------------------
// 状态图标
// ----------------------------------------------------------------

export function StateGlyph({
  state,
  className,
}: {
  state: ItemState;
  className?: string;
}) {
  switch (state) {
    case "running":
      return <Loader2 className={cn("animate-spin text-blue-500", className)} />;
    case "completed":
      return <Check className={cn("text-green-500", className)} />;
    case "error":
      return <AlertCircle className={cn("text-red-500", className)} />;
    case "warning":
      return <AlertCircle className={cn("text-amber-500", className)} />;
    case "paused":
      return <Loader2 className={cn("text-amber-500", className)} />;
    case "cancelled":
      return <CircleSlash className={cn("text-muted-foreground", className)} />;
    case "pending":
      return (
        <Circle
          className={cn("text-muted-foreground/50", className)}
          strokeWidth={1.5}
        />
      );
    default:
      return (
        <Circle
          className={cn("fill-muted-foreground/20 text-muted-foreground/40", className)}
        />
      );
  }
}

// ----------------------------------------------------------------
// StatusRow
// ----------------------------------------------------------------

export interface StatusRowProps {
  /** 条目状态（决定默认 leading glyph） */
  state: ItemState;
  /** 主标题 */
  title: string;
  /** 副标题（可选，小字 muted） */
  subtitle?: string;
  /** 自定义 leading 图标（覆盖 state glyph） */
  icon?: ReactNode;
  /** 右侧常驻附属内容（如计数 "3/5"） */
  accessory?: ReactNode;
  /** hover 显现的操作按钮组 */
  trailing?: ReactNode;
  /** 点击行回调（设为可交互） */
  onActivate?: () => void;
  className?: string;
}

export function StatusRow({
  state,
  title,
  subtitle,
  icon,
  accessory,
  trailing,
  onActivate,
  className,
}: StatusRowProps) {
  return (
    <div
      role={onActivate ? "button" : undefined}
      tabIndex={onActivate ? 0 : undefined}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
      className={cn(
        "group/row flex items-center gap-2 rounded-md px-2 py-1 transition-colors",
        onActivate && "cursor-pointer hover:bg-muted",
        className,
      )}
    >
      {/* Leading: 自定义图标或状态 glyph */}
      <span
        className="flex shrink-0 items-center justify-center"
        style={{ width: 16, height: 16 }}
      >
        {icon ?? <StateGlyph state={state} className="h-3.5 w-3.5" />}
      </span>

      {/* Content: 标题 + 副标题 */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-tight text-[#303030]">
          {title}
        </span>
        {subtitle && (
          <span className="block truncate text-[11px] leading-tight text-muted-foreground">
            {subtitle}
          </span>
        )}
      </span>

      {/* Accessory: 常驻右侧（计数等） */}
      {accessory && (
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {accessory}
        </span>
      )}

      {/* Trailing: hover 显现的操作 */}
      {trailing && (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/row:opacity-100">
          {trailing}
        </span>
      )}
    </div>
  );
}
