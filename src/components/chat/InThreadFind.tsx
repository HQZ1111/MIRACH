/**
 * InThreadFind — 会话内查找条（参考 zosma InThreadFind + rehypeHighlightTerm）
 *
 * Ctrl/Cmd+F 呼出；输入时下方实时列出全部命中消息（发送者 + 内容摘要 + 时间，
 * 命中词高亮），点击直接跳转定位（滚动 + 闪烁）；类似微信"查找聊天记录"。
 * 键盘：Enter 下一个 / Shift+Enter 上一个 / ↑↓ 移动 / Esc 关闭。
 * 与左侧 MessageLocator（scrollspy 指示器）互补：前者定位滚动位置，后者按文本查找。
 */

import { useEffect, useMemo, useRef } from "react";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface FindResult {
  role: string;
  text: string;
  time: string;
}

/** 转义 HTML 后把查询词包成 <mark> 高亮（防会话内容注入） */
function highlightText(text: string, q: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!q) return esc;
  const qe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc.replace(new RegExp(`(${qe})`, "gi"), (m) => `<mark class="rounded-sm bg-yellow-200/80">${m}</mark>`);
}

function roleBadge(role: string): { label: string; cls: string } {
  if (role === "user") return { label: "我", cls: "bg-[#6366F1]/10 text-[#6366F1]" };
  if (role === "ai") return { label: "AI", cls: "bg-[#10B981]/10 text-[#059669]" };
  return { label: "系统", cls: "bg-muted text-muted-foreground" };
}

/** 结果列表最多展示条数（超出提示"仅显示前 N 条"） */
const MAX_RESULTS = 50;

export function InThreadFind({
  open,
  query,
  setQuery,
  current,
  total,
  onNavigate,
  onClose,
  results = [],
  onSelect,
}: {
  open: boolean;
  query: string;
  setQuery: (q: string) => void;
  /** 当前命中的序号（0-based） */
  current: number;
  /** 命中总数 */
  total: number;
  onNavigate: (dir: 1 | -1) => void;
  onClose: () => void;
  /** 命中消息列表（与 total 顺序一致） */
  results?: FindResult[];
  /** 点击结果跳转 */
  onSelect?: (i: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  // 当前选中的结果行滚动到可见区域（↑↓ 移动时跟随）
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-find-idx="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const visible = useMemo(() => results.slice(0, MAX_RESULTS), [results]);

  if (!open) return null;

  return (
    <div className="absolute left-1/2 top-2 z-40 -translate-x-1/2">
      {/* 查找条 */}
      <div className="panel-glass menu-anim flex items-center gap-1.5 rounded-xl border border-black/10 px-2.5 py-1">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="在会话中查找…"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onNavigate(e.shiftKey ? -1 : 1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              onNavigate(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              onNavigate(-1);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          className="w-40 bg-transparent text-xs text-[#303030] outline-none placeholder:text-muted-foreground"
        />
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
          {query && total > 0 ? `${current + 1}/${total}` : ""}
        </span>
        <button
          onClick={() => onNavigate(-1)}
          title="上一个 (Shift+Enter / ↑)"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          <ArrowUp className="h-3 w-3" />
        </button>
        <button
          onClick={() => onNavigate(1)}
          title="下一个 (Enter / ↓)"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          <ArrowDown className="h-3 w-3" />
        </button>
        <button
          onClick={onClose}
          title="关闭 (Esc)"
          className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* 命中结果列表（微信"查找聊天记录"样式：点条目跳转定位） */}
      {query && total > 0 && visible.length > 0 && (
        <div
          ref={listRef}
          className="panel-glass menu-anim mt-1 max-h-64 w-80 max-w-[85vw] overflow-y-auto rounded-xl py-1 [scrollbar-width:thin]"
        >
          {visible.map((r, i) => {
            const badge = roleBadge(r.role);
            return (
              <button
                key={i}
                data-find-idx={i}
                onClick={() => onSelect?.(i)}
                className={cn(
                  "flex w-full items-start gap-2 px-3 py-1.5 text-left transition-colors",
                  i === current ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className={cn("mt-px shrink-0 rounded px-1.5 py-px text-[10px] font-medium", badge.cls)}>
                  {badge.label}
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className="line-clamp-2 text-xs leading-snug text-[#303030]"
                    dangerouslySetInnerHTML={{ __html: highlightText(r.text, query) }}
                  />
                  <span className="mt-0.5 block text-[10px] tabular-nums text-muted-foreground">{r.time}</span>
                </span>
              </button>
            );
          })}
          {total > MAX_RESULTS && (
            <p className="px-3 py-1.5 text-center text-[10px] text-muted-foreground">
              仅显示前 {MAX_RESULTS} 条，共 {total} 条命中
            </p>
          )}
        </div>
      )}
    </div>
  );
}
