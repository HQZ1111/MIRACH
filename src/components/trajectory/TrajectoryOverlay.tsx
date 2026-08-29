/**
 * TrajectoryOverlay — 运行轨迹弹窗（参考 deepseek-harness TrajectoryView 简化版）
 *
 * 从会话消息 + 工具调用派生事件列表：SYSTEM / USER / AI / TOOL 徽标 + 摘要，
 * 点击行右侧显示详情（完整文本 / 工具输出 / 耗时）；顶部搜索过滤。
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import type { ToolCall } from "@/store/tool-calls";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";

type AnyMsg = {
  role: "user" | "ai" | "system";
  text: string;
  time?: string;
  systemType?: string;
};

interface TrajEvent {
  id: string;
  kind: "SYSTEM" | "USER" | "AI" | "TOOL";
  summary: string;
  detail: string;
  time?: string;
  status?: string;
  toolCall?: ToolCall;
}

const KIND_STYLE: Record<TrajEvent["kind"], string> = {
  SYSTEM: "bg-muted text-muted-foreground",
  USER: "bg-[#017CF3]/12 text-[#017CF3]",
  AI: "bg-[#10B981]/12 text-[#0D9488]",
  TOOL: "bg-[#F59E0B]/12 text-[#B45309]",
};

/** 从消息 + 工具调用派生轨迹事件（不单独存储，参考 dsh 投影式） */
function deriveEvents(msgs: AnyMsg[], toolCalls: ToolCall[]): TrajEvent[] {
  const events: TrajEvent[] = [];
  msgs.forEach((m, i) => {
    const kind: TrajEvent["kind"] =
      m.role === "system" ? "SYSTEM" : m.role === "user" ? "USER" : "AI";
    events.push({
      id: `m${i}`,
      kind,
      summary: m.text.length > 120 ? `${m.text.slice(0, 120)}…` : m.text,
      detail: m.text,
      time: m.time,
    });
  });
  toolCalls.forEach((c, i) => {
    events.push({
      id: `t${i}`,
      kind: "TOOL",
      summary: `${c.name} · ${c.title}`,
      detail: c.detail ?? c.title,
      status: c.status,
      time: c.durationSec !== undefined ? `${c.durationSec}s` : undefined,
      toolCall: c,
    });
  });
  return events;
}

export function TrajectoryOverlay({
  open,
  onClose,
  msgs,
  toolCalls,
}: {
  open: boolean;
  onClose: () => void;
  msgs: AnyMsg[];
  toolCalls: ToolCall[];
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  // 行内展开（折叠/展开全部，参考 dsh TrajectoryToolbar）
  const [allExpanded, setAllExpanded] = useState(false);
  const [inlineOpen, setInlineOpen] = useState<Set<string>>(new Set());

  const events = useMemo(() => deriveEvents(msgs, toolCalls), [msgs, toolCalls]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) => e.summary.toLowerCase().includes(q) || e.detail.toLowerCase().includes(q),
    );
  }, [events, query]);

  const toggleInline = (id: string) => {
    setInlineOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;
  const sel = events.find((e) => e.id === selected) ?? null;
  const isOpen = (id: string) => allExpanded || inlineOpen.has(id);

  return (
    <OverlayShell title="运行轨迹" width={980} height={680} onClose={onClose}>
      <div className="flex h-full">
        {/* 左：事件列表 */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* 搜索 + 折叠控制 */}
          <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-3 py-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索轨迹…"
                className="w-full rounded-md border border-border bg-white py-1 pl-7 pr-7 text-xs text-[#303030] outline-none focus:border-[#6366F1]"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#303030]"
                  aria-label="清除搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <button
              onClick={() => setAllExpanded((v) => !v)}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
            >
              {allExpanded ? "全部折叠" : "全部展开"}
            </button>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {filtered.length} 条
            </span>
          </div>

          {/* 事件列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filtered.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">无匹配轨迹</p>
            ) : (
              filtered.map((e) => {
                const open = isOpen(e.id);
                return (
                  <div key={e.id} className="border-b border-black/5">
                    <button
                      onClick={() => {
                        setSelected(e.id);
                        toggleInline(e.id);
                      }}
                      className={cn(
                        "flex w-full items-start gap-2 px-3 py-2 text-left transition-colors",
                        selected === e.id ? "bg-[#017CF3]/8" : "hover:bg-muted/50",
                      )}
                    >
                      <span className="mt-px shrink-0">
                        {open ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 pt-px">
                        <span
                          className={cn(
                            "rounded px-1.5 py-px text-[9px] font-semibold tracking-wide",
                            KIND_STYLE[e.kind],
                          )}
                        >
                          {e.kind}
                        </span>
                        {e.time && (
                          <span className="text-[10px] tabular-nums text-muted-foreground/70">{e.time}</span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-[#303030]">{e.summary}</span>
                        {e.status && (
                          <span
                            className={cn(
                              "mt-0.5 inline-block text-[10px] font-medium",
                              e.status === "running"
                                ? "text-[#F59E0B]"
                                : e.status === "error"
                                  ? "text-[#EF4444]"
                                  : "text-[#10B981]",
                            )}
                          >
                            {e.status}
                          </span>
                        )}
                      </span>
                    </button>
                    {/* 行内展开：完整内容（参考 dsh TrajectoryTable 行展开） */}
                    {open && (
                      <div className="border-l-2 border-black/5 px-4 pb-2 pl-[38px]">
                        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#303030] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {e.detail}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右：详情 */}
        <div className="flex w-[380px] shrink-0 flex-col border-l border-black/5">
          {sel ? (
            <>
              <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-3 py-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-px text-[9px] font-semibold tracking-wide",
                    KIND_STYLE[sel.kind],
                  )}
                >
                  {sel.kind}
                </span>
                <span className="text-[11px] text-muted-foreground">{sel.time ?? ""}</span>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#303030]">
                  {sel.detail}
                </pre>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
              点击左侧事件查看详情
            </div>
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
