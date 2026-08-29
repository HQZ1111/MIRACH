/**
 * CalendarPopover — 月历弹层（聊天记录日期筛选）
 *
 * 周一开头；上月/下月切换、今天、清除；有消息的日期显示小圆点；
 * 选择某天 → onSelect(yyyy-MM-dd)，清除 → onSelect(null)。
 */

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface CalendarPopoverProps {
  /** 当前显示的月份（任意日期即可，只取年月） */
  month: Date;
  onMonthChange: (m: Date) => void;
  /** 有消息的日期集合（yyyy-MM-dd） */
  marked: Set<string>;
  /** 当前选中的日期（yyyy-MM-dd 或 null） */
  selected: string | null;
  onSelect: (day: string | null) => void;
  onClose: () => void;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CalendarPopover({ month, onMonthChange, marked, selected, onSelect, onClose }: CalendarPopoverProps) {
  const year = month.getFullYear();
  const m = month.getMonth();

  // 6 行网格：月初对齐周一
  const cells = useMemo(() => {
    const first = new Date(year, m, 1);
    const startDow = (first.getDay() + 6) % 7; // 周一=0
    const daysInMonth = new Date(year, m + 1, 0).getDate();
    const out: (Date | null)[] = [
      ...Array<null>(startDow).fill(null),
      ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, m, i + 1)),
    ];
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [year, m]);

  const todayStr = fmtDay(new Date());

  return (
    <div className="panel-glass menu-anim absolute left-0 top-full z-50 mt-1 w-64 rounded-xl p-3">
      {/* 头部：‹ 2026年8月 › */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => onMonthChange(new Date(year, m - 1, 1))}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-[#303030]">
          {year}年{m + 1}月
        </span>
        <button
          onClick={() => onMonthChange(new Date(year, m + 1, 1))}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 星期 */}
      <div className="mt-2 grid grid-cols-7 text-center text-[10px] text-muted-foreground">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1">{w}</span>
        ))}
      </div>

      {/* 日期网格 */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {cells.map((d, i) =>
          d === null ? (
            <span key={`e${i}`} />
          ) : (
            <button
              key={i}
              onClick={() => {
                onSelect(fmtDay(d));
                onClose();
              }}
              className={cn(
                "relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors",
                selected === fmtDay(d)
                  ? "bg-[#303030] text-white"
                  : "text-[#303030] hover:bg-muted",
                fmtDay(d) === todayStr && selected !== fmtDay(d) && "ring-1 ring-[#6366F1]/40",
              )}
            >
              {d.getDate()}
              {marked.has(fmtDay(d)) && (
                <span
                  className={cn(
                    "absolute bottom-0.5 h-1 w-1 rounded-full",
                    selected === fmtDay(d) ? "bg-white" : "bg-[#6366F1]",
                  )}
                />
              )}
            </button>
          ),
        )}
      </div>

      {/* 快捷操作 */}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <button
          onClick={() => {
            onSelect(todayStr);
            onClose();
          }}
          className="rounded-md px-2 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
        >
          今天
        </button>
        <button
          onClick={() => {
            onSelect(null);
            onClose();
          }}
          className="rounded-md px-2 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
        >
          全部日期
        </button>
      </div>
    </div>
  );
}
