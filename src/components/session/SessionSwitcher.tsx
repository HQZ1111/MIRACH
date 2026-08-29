/**
 * SessionSwitcher — ⌘J 会话切换器（轻量版原型 Quick Switcher）
 *
 * 快捷键（默认 Ctrl/Cmd+J）打开；输入过滤会话，↑↓ 导航，Enter 切换，Esc 关闭。
 * 复用命令面板的弹层样式（fixed + portal 语义一致，直接渲染即可）。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { $sessions } from "@/store/sessions";
import { setActiveSession, $activeSessionId } from "@/store/session";
import { cn } from "@/lib/utils";

export function SessionSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sessions = useStore($sessions);
  const activeId = useStore($activeSessionId);
  const [query, setQuery] = useState("");
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const list = useMemo(
    () =>
      sessions.filter(
        (s) => !s.archived && (!query.trim() || s.title.toLowerCase().includes(query.trim().toLowerCase())),
      ),
    [sessions, query],
  );

  // 打开时重置状态并聚焦输入框
  useEffect(() => {
    if (open) {
      setQuery("");
      setIdx(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  // Esc 关闭（输入框内 Esc + 全局兜底）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (id: string) => {
    setActiveSession(id);
    onClose();
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIdx((i) => Math.min(i + 1, list.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = list[Math.min(idx, list.length - 1)];
      if (target) pick(target.id);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" onClick={onClose} />
      <div className="panel-glass popup-anim relative z-50 w-[480px] max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2 border-b border-border/70 px-3">
          <span className="font-mono text-[11px] text-muted-foreground">⌘J</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder="跳转到会话…（↑↓ 选择 · Enter 打开 · Esc 关闭）"
            className="h-10 min-w-0 flex-1 bg-transparent text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {list.length === 0 ? (
            <p className="px-3 py-3 text-body-sm text-muted-foreground">没有匹配的会话</p>
          ) : (
            list.map((s, i) => (
              <button
                key={s.id}
                onClick={() => pick(s.id)}
                onMouseEnter={() => setIdx(i)}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-2 text-left transition-colors",
                  i === idx ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-body-sm text-[#303030]">{s.title}</span>
                {s.id === activeId && <span className="shrink-0 text-[10px] text-[#6366F1]">当前</span>}
                <span className="shrink-0 text-[11px] text-muted-foreground">{s.time}</span>
              </button>
            ))
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/70 bg-muted/20 px-3 py-1.5">
          <span className="text-[10px] text-muted-foreground">{list.length} 个会话</span>
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
            <span><kbd className="font-mono">↑↓</kbd> 导航</span>
            <span><kbd className="font-mono">Enter</kbd> 打开</span>
            <span><kbd className="font-mono">Esc</kbd> 关闭</span>
          </div>
        </div>
      </div>
    </div>
  );
}
