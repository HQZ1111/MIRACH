/**
 * TrajectoryOverlay — 运行轨迹弹窗（官方 ui-trajectory 对齐版）
 *
 * 数据源升级为官方装配层：Turn/Step 时间线（$assemblyTimeline）+ 原始
 * SessionEvent（$rawEvents），每轮附官方 deriveTurnTokenUsage 的精确 token
 * 账目（TurnUsageDisclosure 同源）。结构对齐官方轨迹视图：
 *   Turn 分组（状态/耗时/步数/token）→ Step 行（耗时）→ 事件行（USER/AI/TOOL）
 * 时间线为空（mock/未产生事件）时回落旧的"消息数组派生"路径。
 */

import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import type { ToolCall } from "@/store/tool-calls";
import { $assemblyTimeline } from "@/dsh-assembly/store";
import { $rawEvents } from "@/store/session-events";
import { deriveTurnTokenUsage, sumTurnUsage, type TurnTokenUsage } from "@/dsh-assembly/turn-usage";
import { formatTokens } from "@/components/chat/StatsLine";
import { ChevronDown, ChevronRight, Search, X } from "lucide-react";

type AnyMsg = {
  role: "user" | "ai" | "system";
  text: string;
  time?: string;
  systemType?: string;
};

interface TrajRow {
  id: string;
  seq: number;
  kind: "SYSTEM" | "USER" | "AI" | "TOOL" | "STEP";
  summary: string;
  detail: string;
  time?: string;
  status?: string;
}

interface TurnGroup {
  turn: number;
  status: "open" | "closed" | "unknown";
  /** 首末事件墙钟跨度（ms）；事件不足两条时 null */
  durMs: number | null;
  stepCount: number;
  usage?: TurnTokenUsage;
  /** true = usage 来自采样求和（≈近似），false/缺省 = 官方精确账目 */
  usageApprox?: boolean;
  rows: TrajRow[];
}

const KIND_STYLE: Record<TrajRow["kind"], string> = {
  SYSTEM: "bg-muted text-muted-foreground",
  USER: "bg-[#017CF3]/12 text-[#017CF3]",
  AI: "bg-[#10B981]/12 text-[#0D9488]",
  TOOL: "bg-[#F59E0B]/12 text-[#B45309]",
  STEP: "bg-[#8B5CF6]/12 text-[#7C3AED]",
};

/** 紧凑时长：45.2s / 2m42s */
function formatDuration(ms: number): string {
  const s = ms / 1_000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

function textOf(content: unknown): string {
  return ((content as { type?: string; text?: string }[] | undefined) ?? [])
    .filter((c) => c?.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}

const summarize = (text: string, cap = 120): string =>
  text.length > cap ? `${text.slice(0, cap)}…` : text;

/** 时间上下文注入（写给模型感知时间流逝）不属于对话，轨迹过滤（同 history.ts） */
const isTimeContext = (text: string): boolean =>
  /^Time sampled while preparing turn \d+, step \d+:/m.test(text);

/**
 * 官方装配层路径：timeline（Turn/Step 结构）+ raw（事件内容）→ Turn 分组。
 * 每轮喂 deriveTurnTokenUsage 得精确账目；工具行 tool/call→result 按 callId 配对。
 */
function buildGroups(
  timeline: ReturnType<typeof $assemblyTimeline.get>,
  raw: ReturnType<typeof $rawEvents.get>,
): TurnGroup[] {
  if (timeline.turnOrder.length === 0) return [];
  const byTurn = new Map<number, typeof raw>();
  for (const ev of raw) {
    const turn = (ev.data as { turn?: unknown } | null)?.turn;
    if (typeof turn !== "number") continue;
    const list = byTurn.get(turn);
    if (list) list.push(ev);
    else byTurn.set(turn, [ev]);
  }
  return timeline.turnOrder.map((turn) => {
    const loc = timeline.turns.get(turn);
    const evs = byTurn.get(turn) ?? [];
    // 精确账目优先（官方 deriveTurnTokenUsage）；provider 不报全桶时退
    // 采样求和（≈），轨迹头仍可参考（官方语义：不可证明不猜测，这里额外
    // 给出显式标注的近似值）
    const exact = deriveTurnTokenUsage(evs);
    const approx = exact === undefined ? sumTurnUsage(evs) : undefined;
    const usage = exact ?? approx;
    const usageApprox = exact === undefined && approx !== undefined;
    const rows: TrajRow[] = [];
    // step 边界标记（来自 timeline）：内容行跨过 step.start.seq 时插入 STEP 头
    const steps = loc?.steps ?? [];
    let stepIdx = 0;
    let rowSeq = 0;
    const flushSteps = (beforeSeq: number): void => {
      while (stepIdx < steps.length && steps[stepIdx] && (steps[stepIdx]!.start?.seq ?? -1) < beforeSeq) {
        const st = steps[stepIdx]!;
        const dur = st.start && st.end ? formatDuration(st.end.time - st.start.time) : undefined;
        rows.push({
          id: `t${turn}-s${st.step}`,
          seq: rowSeq++,
          kind: "STEP",
          summary: `步 ${st.step}`,
          detail: `步 ${st.step} · ${st.status}${dur ? ` · ${dur}` : ""}`,
          time: dur,
          status: st.status,
        });
        stepIdx += 1;
      }
    };
    // 工具配对：callId → {name,args,startTime}
    const open = new Map<string, { name: string; args: string; startTime: number; seq: number }>();
    for (const ev of evs) {
      flushSteps(ev.seq);
      const d = ev.data as {
        role?: string;
        content?: { type?: string; text?: string }[];
        callId?: string;
        name?: string;
        arguments?: string;
        message?: { source?: { callId?: string }; content?: { type?: string; text?: string; isError?: boolean }[] };
      };
      if (ev.type === "user/message" && d.role === "user") {
        const so = (ev as { surfaceOp?: unknown }).surfaceOp;
        if (so === "replace" || (typeof so === "object" && so !== null && (so as { op?: string }).op === "replace")) continue;
        const text = textOf(d.content);
        if (!text || isTimeContext(text)) continue;
        rows.push({ id: `t${turn}-u${ev.seq}`, seq: rowSeq++, kind: "USER", summary: summarize(text), detail: text });
      } else if (ev.type === "assistant/message") {
        const text = textOf(d.message && (d.message as { content?: unknown }).content);
        const thinking = ((d.message as { content?: { type?: string; text?: string }[] } | undefined)?.content ?? [])
          .filter((c) => c?.type === "reasoning")
          .map((c) => c.text ?? "")
          .join("");
        if (!text && !thinking) continue;
        rows.push({
          id: `t${turn}-a${ev.seq}`,
          seq: rowSeq++,
          kind: "AI",
          summary: summarize(text || `[思考] ${summarize(thinking, 100)}`),
          detail: text + (thinking ? `${text ? "\n\n" : ""}—— 思考 ——\n${thinking}` : ""),
        });
      } else if (ev.type === "tool/call") {
        if (d.callId) {
          open.set(d.callId, { name: d.name ?? "tool", args: d.arguments ?? "", startTime: ev.time, seq: ev.seq });
        }
      } else if (ev.type === "tool/result") {
        const callId = d.message?.source?.callId ?? "";
        const call = open.get(callId);
        open.delete(callId);
        const result = ((d.message?.content ?? []) as { content?: { text?: string }[] }[])
          .flatMap((c) => (c?.content ?? []).map((t) => t?.text ?? ""))
          .join("");
        const isError = ((d.message?.content ?? []) as { isError?: boolean }[]).some((c) => c?.isError);
        rows.push({
          id: `t${turn}-t${ev.seq}`,
          seq: rowSeq++,
          kind: "TOOL",
          summary: `${call?.name ?? "tool"}${result ? ` · ${summarize(result.replace(/\s+/g, " "), 80)}` : ""}`,
          detail: `${call?.name ?? "tool"}\n\n[参数]\n${call?.args ?? "（无）"}${result ? `\n\n[结果]${isError ? "（错误）" : ""}\n${result}` : ""}`,
          time: call ? formatDuration(ev.time - call.startTime) : undefined,
          status: isError ? "error" : "completed",
        });
      }
    }
    flushSteps(Number.MAX_SAFE_INTEGER);
    // 未闭合的工具（运行中/被中断）
    for (const [callId, call] of open) {
      rows.push({
        id: `t${turn}-to${callId}`,
        seq: rowSeq++,
        kind: "TOOL",
        summary: call.name,
        detail: `${call.name}\n\n[参数]\n${call.args}\n\n[结果]（未落地）`,
        time: undefined,
        status: "running",
      });
    }
    rows.sort((a, b) => a.seq - b.seq);
    const durMs = evs.length >= 2 ? evs[evs.length - 1]!.time - evs[0]!.time : null;
    return {
      turn,
      status: loc?.status ?? "unknown",
      durMs: durMs !== null && durMs >= 0 ? durMs : null,
      stepCount: steps.length,
      usage,
      usageApprox,
      rows,
    };
  });
}

/** 回落路径（mock/无事件）：消息数组 + 工具调用派生（旧逻辑原样保留） */
function legacyEvents(msgs: AnyMsg[], toolCalls: ToolCall[]): TrajRow[] {
  const rows: TrajRow[] = [];
  msgs.forEach((m, i) => {
    const kind: TrajRow["kind"] = m.role === "system" ? "SYSTEM" : m.role === "user" ? "USER" : "AI";
    rows.push({
      id: `m${i}`,
      seq: i,
      kind,
      summary: summarize(m.text),
      detail: m.text,
      time: m.time,
    });
  });
  toolCalls.forEach((c, i) => {
    rows.push({
      id: `t${i}`,
      seq: msgs.length + i,
      kind: "TOOL",
      summary: `${c.name} · ${c.title}`,
      detail: c.detail ?? c.title,
      time: c.durationSec !== undefined ? `${c.durationSec}s` : undefined,
      status: c.status,
    });
  });
  return rows;
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
  const [allExpanded, setAllExpanded] = useState(false);
  const [inlineOpen, setInlineOpen] = useState<Set<string>>(new Set());

  const timeline = useStore($assemblyTimeline);
  const raw = useStore($rawEvents);

  // 官方装配层路径优先；时间线为空（mock/无事件）回落消息派生
  const groups = useMemo(() => buildGroups(timeline, raw), [timeline, raw]);
  const legacy = useMemo(
    () => (groups.length === 0 ? legacyEvents(msgs, toolCalls) : []),
    [groups.length, msgs, toolCalls],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (r: TrajRow): boolean =>
      !q || r.summary.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q);
    if (groups.length > 0) {
      return groups
        .map((g) => ({ ...g, rows: g.rows.filter(match) }))
        .filter((g) => g.rows.length > 0);
    }
    return legacy.filter(match).map((r) => ({
      turn: 0, status: "unknown" as const, durMs: null, stepCount: 0, usage: undefined, rows: [r],
    }));
  }, [groups, legacy, query]);

  const toggleInline = (id: string) => {
    setInlineOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;
  const allRows = filtered.flatMap((g) => g.rows);
  const sel = allRows.find((r) => r.id === selected) ?? null;
  const isOpen = (id: string) => allExpanded || inlineOpen.has(id);

  return (
    <OverlayShell title="运行轨迹" width={980} height={680} onClose={onClose}>
      <div className="flex h-full">
        {/* 左：Turn 分组 + 事件列表 */}
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
              {allRows.length} 条
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {allRows.length === 0 ? (
              <p className="py-10 text-center text-xs text-muted-foreground">无匹配轨迹</p>
            ) : (
              filtered.map((g) => (
                <div key={g.turn}>
                  {/* Turn 分组头：轮号/状态/耗时/步数/精确 token（官方 TurnUsageDisclosure 同源） */}
                  <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-black/10 bg-[#FAFAFA]/95 px-3 py-1.5 backdrop-blur">
                    <span className="text-[11px] font-semibold text-[#303030]">
                      {g.turn > 0 ? `第 ${g.turn} 轮` : "会话"}
                    </span>
                    {g.status === "open" && (
                      <span className="rounded bg-[#F59E0B]/12 px-1.5 py-px text-[9px] font-semibold text-[#B45309]">运行中</span>
                    )}
                        {g.turn > 0 && (
                          <span className="text-[10px] tabular-nums text-muted-foreground">
                            {g.stepCount} 步{g.durMs !== null ? ` · ${formatDuration(g.durMs)}` : ""}
                            {g.usage ? ` · ↑${g.usageApprox ? "≈" : ""}${formatTokens(g.usage.totalTokens)} tokens` : ""}
                            {g.usage?.cacheReadTokens !== undefined ? `（缓存读 ${formatTokens(g.usage.cacheReadTokens)}）` : ""}
                          </span>
                        )}
                  </div>
                  {g.rows.map((e) => {
                    const rowOpen = isOpen(e.id);
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
                            {rowOpen ? (
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
                            <span className={cn(
                              "block truncate text-xs text-[#303030]",
                              e.kind === "STEP" && "font-medium text-[#7C3AED]",
                            )}>{e.summary}</span>
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
                        {rowOpen && (
                          <div className="border-l-2 border-black/5 px-4 pb-2 pl-[38px]">
                            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-[#303030] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                              {e.detail}
                            </pre>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
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
