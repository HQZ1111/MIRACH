/**
 * LogsOverlay — 导出日志弹窗（顶栏下拉打开）
 *
 * 展示应用日志缓冲（console / 未捕获错误，最近 200 条），
 * 支持刷新、清空、导出 .txt。
 */

import { useState } from "react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "./OverlayShell";
import { getLogs, clearLogs, exportLogs, type LogEntry } from "@/lib/logger";
import { ArrowClockwise, Download, Trash } from "@phosphor-icons/react";

export function LogsOverlay({ onClose }: { onClose: () => void }) {
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const refresh = () => setLogs(getLogs());

  return (
    <OverlayShell
      title="导出日志"
      width={900}
      height={600}
      onClose={onClose}
      titleExtra={
        <>
          <button
            onClick={refresh}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted"
          >
            <ArrowClockwise className="h-3 w-3" />
            刷新
          </button>
          <button
            onClick={() => {
              clearLogs();
              refresh();
            }}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted"
          >
            <Trash className="h-3 w-3" />
            清空
          </button>
          <button
            onClick={exportLogs}
            className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Download className="h-3 w-3" />
            导出 .txt
          </button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col p-3">
        {logs.length === 0 ? (
          <p className="pt-8 text-center text-body-sm text-muted-foreground">
            暂无日志（console 输出会被捕获到这里）
          </p>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto font-mono text-[11px] leading-relaxed [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-2 border-b border-black/[0.04] py-1">
                <span className="shrink-0 text-muted-foreground/70">{l.time}</span>
                <span
                  className={cn(
                    "w-10 shrink-0 font-medium",
                    l.level === "error" ? "text-red-500" : l.level === "warn" ? "text-amber-500" : "text-[#6366F1]",
                  )}
                >
                  {l.level.toUpperCase()}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all text-[#303030]">
                  {l.message}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </OverlayShell>
  );
}
