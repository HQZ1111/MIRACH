/**
 * StatsLine — 会话统计条（移植自 dsh ui-conversation StatsLine 的可行子集）
 *
 * 对齐 dsh 的 `|` 分组格式：
 *   第 N 轮 · M 步 | 缓存命中 88% · 输入 12.2K 输出 517
 * token 计量取真实 usage（token-meter 同源字段）；LLM/工具耗时与 TTFT 依赖
 * 引擎 timing 字段，Mirach 暂未记录——待 usage store 扩展后补齐。
 * 超长省略号 + 悬停看全文（ResizeObserver 测宽，同 dsh）。
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { UsageRecord } from "@/store/usage";

/** 紧凑 token：517 / 12.2K / 517K / 1.2M（三位以内保留一位小数，同 dsh） */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
  return `${scaled(n / 1_000_000)}M`;
}

/** 计费侧输入 = 未命中 + 缓存读（同 dsh billedInputTokens；Mirach 暂无 cacheWrite 计量） */
export function billedInputTokens(usage: UsageRecord): number {
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
}

/** 缓存命中占比（取整百分比；无输入账单时 null） */
export function cacheHitPercent(usage: UsageRecord): number | null {
  const denominator = billedInputTokens(usage);
  return denominator === 0
    ? null
    : Math.round(((usage.cacheReadTokens ?? 0) / denominator) * 100);
}

/** 从消息列表推导轮/步（Mirach：一条 AI 回复 = 一步；每轮一条 assistant） */
function deriveCounts(msgs: { role: string }[]): { turns: number; steps: number } {
  const ai = msgs.filter((m) => m.role === "ai");
  return { turns: ai.length, steps: ai.length };
}

interface StatsLineProps {
  /** 消息列表（mock 会话消息与实时消息的字段超集均可：只用 role/text） */
  msgs: { role: string; text: string }[];
  usage?: UsageRecord;
  className?: string;
}

export const StatsLine = memo(function StatsLine({ msgs, usage, className }: StatsLineProps) {
  const counts = useMemo(() => deriveCounts(msgs as { role: string }[]), [msgs]);
  const groups: string[] = [];
  if (counts.turns > 0) {
    groups.push(`第 ${counts.turns} 轮 · ${counts.steps} 步`);
  }
  if (usage && (billedInputTokens(usage) > 0 || (usage.outputTokens ?? 0) > 0)) {
    const cacheHit = cacheHitPercent(usage);
    if (cacheHit !== null) groups.push(`缓存命中 ${cacheHit}%`);
    groups.push(`输入 ${formatTokens(billedInputTokens(usage))} · 输出 ${formatTokens(usage.outputTokens ?? 0)}`);
  }
  const line = groups.join("  |  ");

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [truncated, setTruncated] = useState(false);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const measure = () => setTruncated(el.scrollWidth > el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [line]);

  if (groups.length === 0) return null;
  return (
    <div ref={rootRef} title={truncated ? line : undefined} className={cn("text-center text-[10px] text-muted-foreground/70", className)}>
      {groups.map((g, i) => (
        <span key={g}>
          {i > 0 && <span aria-hidden className="mx-2 text-muted-foreground/40">|</span>}
          <span>{g}</span>
        </span>
      ))}
    </div>
  );
});