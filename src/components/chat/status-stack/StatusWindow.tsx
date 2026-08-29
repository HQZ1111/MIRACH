/**
 * StatusWindow - 对话区右上角浮动活动窗口（可折叠）
 *
 * 折叠态：右上角一个小药丸按钮（图标 + 活动 + 活条目角标），点击展开。
 * 展开态：白色浮动面板（标题栏 + 可滚动内容），内容为 StatusStack 全部面板。
 * 点击面板外任意区域自动收起。
 *
 * 标题栏：收起按钮左侧是"自动展开"开关 —— 开启后，
 * 有新状态（活条目数增加）时窗口自动从折叠态展开。
 *
 * 角标计数：队列 + 后台进程 + 子代理 + 进行中待办 + 进行中目标。
 */

import { useEffect, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Activity, ChevronDown, ChevronUp, Sparkles, SquareTerminal } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTerminalStatus } from "@/hooks/useTerminalStatus";
import { StatusStack } from "./StatusStack";
import { $queueCount } from "@/store/queue";
import { $bgState } from "@/store/background-processes";
import { $subagentState } from "@/store/subagents";
import { $todosState } from "@/store/todos";
import { $goalState } from "@/store/goals";

const AUTO_EXPAND_KEY = "mirach.statusAutoExpand";

/** 运行中的终端按钮（状态窗口内，自动展开开关左侧；点击弹窗列出终端实例） */
function TerminalButton() {
  const { terminals, runningCount } = useTerminalStatus();
  const [popup, setPopup] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setPopup((v) => !v)}
        title="正在运行的终端"
        className={cn(
          "flex h-5 items-center gap-0.5 rounded px-1 transition-colors",
          popup ? "bg-muted" : "hover:bg-muted",
        )}
      >
        <SquareTerminal
          className="h-3.5 w-3.5"
          color={runningCount > 0 ? "#10B981" : "#464646"}
        />
        <span className="text-[11px] font-medium text-[#303030]">{runningCount}</span>
      </button>

      {popup && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setPopup(false)} />
          <div className="panel-glass menu-anim absolute right-0 top-full z-30 mt-1 w-60 rounded-xl p-3">
            <p className="text-xs font-medium text-[#303030]">终端运行任务</p>
            {terminals.length === 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">没有运行中的终端</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {terminals.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-xs text-[#303030]">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        t.running ? "bg-[#10B981]" : "bg-[#D1D5DB]",
                      )}
                    />
                    <span className="flex-1 truncate">{t.id}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {t.running ? "运行中" : "已停止"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function StatusWindow({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  // 自动展开开关（localStorage 持久化）
  const [autoExpand, setAutoExpand] = useState(() => {
    try {
      return localStorage.getItem(AUTO_EXPAND_KEY) === "1";
    } catch {
      return false;
    }
  });
  const rootRef = useRef<HTMLDivElement>(null);

  // ---- 活条目计数（角标） ----
  const queueCount = useStore($queueCount);
  const { processes } = useStore($bgState);
  const { agents } = useStore($subagentState);
  const { items } = useStore($todosState);
  const goal = useStore($goalState);

  const activeTodos = items.filter(
    (t) => t.status !== "completed" && t.status !== "cancelled",
  ).length;
  const goalActive = goal.status === "active" || goal.status === "waiting" ? 1 : 0;
  const count = queueCount + processes.length + agents.length + activeTodos + goalActive;

  // 上一帧计数（自动展开用：只在计数增加时展开，完成/减少不收起）
  const prevCountRef = useRef(count);
  useEffect(() => {
    if (count > prevCountRef.current && autoExpand) {
      setOpen(true);
    }
    prevCountRef.current = count;
  }, [count, autoExpand]);

  const toggleAutoExpand = () => {
    setAutoExpand((v) => {
      const next = !v;
      try {
        localStorage.setItem(AUTO_EXPAND_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  // 点击窗口外区域 → 收起
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div ref={rootRef} className={cn("absolute right-3 top-3 z-30", className)}>
      {open ? (
        /* ---- 展开态：浮动面板 ---- */
        <div className="panel-glass menu-anim w-[300px] overflow-hidden rounded-xl">
          {/* 标题栏 */}
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <Activity className="h-3.5 w-3.5 text-[#6366F1]" />
            <span className="text-[12px] font-medium text-[#303030]">活动</span>
            {count > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                {count}
              </span>
            )}
            {/* 运行中的终端（自动展开开关左侧） */}
            <TerminalButton />
            {/* 自动展开开关（收起按钮左侧） */}
            <button
              onClick={toggleAutoExpand}
              title={autoExpand ? "自动展开：开（有新状态时自动展开）" : "自动展开：关"}
              className={cn(
                "ml-auto flex h-5 w-5 items-center justify-center rounded transition-colors",
                autoExpand
                  ? "bg-[#6366F1]/10 text-[#6366F1]"
                  : "text-muted-foreground hover:bg-muted hover:text-[#303030]",
              )}
            >
              <Sparkles className={cn("h-3.5 w-3.5", autoExpand && "fill-current")} />
            </button>
            <button
              onClick={() => setOpen(false)}
              title="折叠"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
          </div>
          {/* 内容区（各面板自管数据，空时自动隐藏） */}
          <div className="max-h-[46vh] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <StatusStack />
          </div>
        </div>
      ) : (
        /* ---- 折叠态：单一胶囊（自动展开按钮在右二位置，▾ 左侧） ---- */
        <div className="flex items-center gap-0.5 rounded-full border border-black/10 bg-white py-1 pl-2 pr-1.5 shadow-sm">
          <button
            onClick={() => setOpen(true)}
            title="展开活动窗口"
            className="flex items-center gap-1.5"
          >
            <Activity className="h-3.5 w-3.5 text-[#6366F1]" />
            <span className="text-[11px] font-medium text-[#303030]">活动</span>
            {count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#6366F1] px-1 text-[10px] font-medium text-white">
                {count}
              </span>
            )}
          </button>
          {/* 运行中的终端（自动展开开关左侧） */}
          <TerminalButton />
          <button
            onClick={toggleAutoExpand}
            title={autoExpand ? "自动展开：开（有新状态时自动展开）" : "自动展开：关"}
            className={cn(
              "flex h-5 w-5 items-center justify-center rounded-full transition-colors",
              autoExpand
                ? "bg-[#6366F1]/15 text-[#6366F1]"
                : "text-muted-foreground hover:bg-muted hover:text-[#303030]",
            )}
          >
            <Sparkles className={cn("h-3 w-3", autoExpand && "fill-current")} />
          </button>
          <button
            onClick={() => setOpen(true)}
            title="展开活动窗口"
            className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted"
          >
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
