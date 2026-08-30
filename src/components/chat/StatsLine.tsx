/**
 * StatsLine — 会话统计条（官方 ui-conversation StatsLine 对齐版）
 *
 * 数据源升级为官方投影（dsh-assembly 在 $rawEvents 上折叠，同 web 版
 * sessionStats/tokenUsage 投影逐字段一致），无投影值时回落旧的窗口近似：
 *   官方组序：第 N 轮 · M 步 | LLM 45.2s · 工具 1m42s | 首字 2.1s · 38.5 tok/s
 *             | 缓存命中 88% · 输入 12.2K 输出 517
 *   回落组序：第 N 轮 · M 步 | 缓存命中 88% · 输入 12.2K 输出 517
 * 投影来自全量日志（含历史回放），翻页/压缩/重启都不变；LLM/工具耗时、
 * TTFT 与解码速度只有官方折叠能给（engine 时间戳来自事件 time）。
 * 超长省略号 + 悬停看全文（ResizeObserver 测宽，同官方）。
 */
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import type { UsageRecord } from "@/store/usage";
import { $assemblyProjections } from "@/dsh-assembly/store";
import type { SessionStatsProjection, TokenUsageProjection } from "@/dsh-assembly/projections";

/** 紧凑 token：517 / 12.2K / 517K / 1.2M（三位以内保留一位小数，同官方） */
export function formatTokens(n: number): string {
  const scaled = (v: number): string =>
    v >= 100 ? String(Math.round(v)) : String(Math.round(v * 10) / 10);
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${scaled(n / 1_000)}K`;
  return `${scaled(n / 1_000_000)}M`;
}

/** 紧凑时长：45.2s / 2m42s（同官方 formatDuration） */
function formatDuration(ms: number): string {
  const s = ms / 1_000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

/** 计费侧输入 = 未命中 + 缓存读（回落路径：UsageRecord 无 cacheWrite 桶） */
export function billedInputTokens(usage: UsageRecord): number {
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0);
}

/** 官方计费侧输入 = 三段互斥 prompt 桶之和（含 cacheWrite） */
export function billedInputOfProjection(usage: TokenUsageProjection): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

/** 缓存命中占比（取整百分比；无输入账单时 null） */
export function cacheHitPercent(usage: UsageRecord): number | null {
  const denominator = billedInputTokens(usage);
  return denominator === 0
    ? null
    : Math.round(((usage.cacheReadTokens ?? 0) / denominator) * 100);
}

/** 投影版缓存命中（分母含 cacheWrite，与官方 token-format 同式） */
function cacheHitOfProjection(usage: TokenUsageProjection): string | null {
  const denominator = billedInputOfProjection(usage);
  if (denominator === 0) return null;
  const percent = (usage.cacheReadTokens / denominator) * 100;
  if (percent >= 100) return "100";
  const rounded = Math.round(percent);
  return String(rounded < 100 ? rounded : Math.floor(percent * 10) / 10);
}

/** 从消息列表推导轮/步（回落：一条 AI 回复 = 一步；每轮一条 assistant） */
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
  const projections = useStore($assemblyProjections);
  const projectedStats: SessionStatsProjection | undefined = projections.sessionStats;
  const projectedUsage: TokenUsageProjection | undefined = projections.tokenUsage;

  const groups: string[] = [];
  const counts = useMemo(() => deriveCounts(msgs as { role: string }[]), [msgs]);

  // 组 1：轮/步 + 工作总时长（投影 turns=有闭合 step 的去重轮数，steps=step/end 计数）
  if (projectedStats) {
    if (projectedStats.steps > 0 || projectedStats.durationMs > 0) {
      const parts: string[] = [];
      if (projectedStats.steps > 0) parts.push(`第 ${projectedStats.turns} 轮 · ${projectedStats.steps} 步`);
      if (projectedStats.durationMs > 0) parts.push(`工作 ${formatDuration(projectedStats.durationMs)}`);
      if (parts.length > 0) groups.push(parts.join(" · "));
    }
  } else if (counts.turns > 0) {
    groups.push(`第 ${counts.turns} 轮 · ${counts.steps} 步`);
  }

  // 组 2：耗时（官方投影独有：LLM 墙钟 / 工具墙钟 / 思考用时）
  if (projectedStats && (projectedStats.llmMs > 0 || projectedStats.toolMs > 0 || projectedStats.thinkingMs > 0)) {
    const parts: string[] = [];
    if (projectedStats.llmMs > 0) parts.push(`LLM ${formatDuration(projectedStats.llmMs)}`);
    if (projectedStats.toolMs > 0) parts.push(`工具 ${formatDuration(projectedStats.toolMs)}`);
    if (projectedStats.thinkingMs > 0) parts.push(`思考 ${formatDuration(projectedStats.thinkingMs)}`);
    groups.push(parts.join(" · "));
  }

  // 组 3：速度（官方投影独有：TTFT 均值 / 解码吞吐）
  if (projectedStats && (projectedStats.ttftSteps > 0 || projectedStats.decodeMs > 0)) {
    const parts: string[] = [];
    if (projectedStats.ttftSteps > 0) {
      parts.push(`首字 ${formatDuration(projectedStats.ttftMs / projectedStats.ttftSteps)}`);
    }
    if (projectedStats.decodeMs > 0) {
      parts.push(`${formatTokens(projectedStats.decodeTokens / (projectedStats.decodeMs / 1_000))} tok/s`);
    }
    groups.push(parts.join(" · "));
  }

  // 组 4：token/缓存（投影：互斥三桶计费输入；回落：usage 事件累计）
  if (projectedUsage) {
    const billed = billedInputOfProjection(projectedUsage);
    if (billed > 0 || projectedUsage.outputTokens > 0) {
      const cacheHit = cacheHitOfProjection(projectedUsage);
      if (cacheHit !== null) groups.push(`缓存命中 ${cacheHit}%`);
      groups.push(`输入 ${formatTokens(billed)} · 输出 ${formatTokens(projectedUsage.outputTokens)}`);
    }
  } else if (usage && (billedInputTokens(usage) > 0 || (usage.outputTokens ?? 0) > 0)) {
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
