/**
 * ConsolePanel — 右侧栏「控制台」日志尾（log-tail）
 *
 * 环形缓冲自动滚底；支持暂停自动滚动（手动上翻时）、清空、按级别过滤。
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { $consoleLines, clearConsole, type ConsoleLine } from "@/store/console";
import { cn } from "@/lib/utils";

const LEVEL_CLS: Record<ConsoleLine["level"], string> = {
  info: "text-[#6B7280]",
  warn: "text-[#B45309]",
  error: "text-[#EF4444]",
  event: "text-[#6366F1]",
};

type Filter = "all" | ConsoleLine["level"];

export function ConsolePanel() {
  const lines = useStore($consoleLines);
  const [filter, setFilter] = useState<Filter>("all");
  const [paused, setPaused] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const visible = filter === "all" ? lines : lines.filter((l) => l.level === filter);

  // 自动滚底（暂停或已滚到顶部时不动；用户手动上翻即暂停）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || paused) return;
    el.scrollTop = el.scrollHeight;
  }, [visible.length, paused]);

  const onScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    // 距离底部 > 24px 视为手动上翻 → 暂停自动滚动
    setPaused(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-1">
          {(["all", "info", "event", "warn", "error"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2 py-0.5 text-[11px] transition-colors",
                filter === f ? "bg-[#303030] text-white" : "text-muted-foreground hover:bg-muted",
              )}
            >
              {f === "all" ? `全部 ${lines.length}` : f}
            </button>
          ))}
        </div>
        <button
          onClick={clearConsole}
          title="清空日志"
          className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          清空
        </button>
      </div>
      <div ref={bodyRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto bg-[#FAFAFA] px-3 py-2 font-mono text-[11px] leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.length === 0 ? (
          <p className="pt-6 text-center text-muted-foreground">暂无日志</p>
        ) : (
          visible.map((l) => (
            <div key={l.id} className="flex gap-2 whitespace-pre-wrap break-all">
              <span className="shrink-0 text-[#C0C4CC]">{l.time}</span>
              <span className={cn("min-w-0 flex-1", LEVEL_CLS[l.level])}>{l.text}</span>
            </div>
          ))
        )}
        {paused && (
          <button
            onClick={() => setPaused(false)}
            className="sticky bottom-0 left-0 mt-1 rounded-md border border-[#6366F1]/40 bg-indigo-50 px-2 py-0.5 text-[10px] text-[#6366F1]"
          >
            已暂停 · 点击恢复滚动
          </button>
        )}
      </div>
    </div>
  );
}
