/**
 * StarmapTimeline — 星图时间轴（S3-5，对应原型 timeline）
 *
 * 48 桶直方图：横轴 = 会话创建时间（左旧右新），桶高 = 该时间段会话数。
 * - 播放：reveal 0→1 渐进点亮节点（与 StarmapView 节点显隐联动）
 * - 点按 / 拖动 scrub：直接定位到任意时刻
 * - 星星装饰用 mulberry32 确定性 PRNG（同数据每次渲染位置一致）
 */

import { useMemo, useRef } from "react";
import { Pause, Play } from "lucide-react";

export const TIMELINE_BUCKETS = 48;

export interface TimelineEntry {
  id: string;
  createdAt: number;
}

export interface TimeAxis {
  counts: number[];
  minTs: number;
  maxTs: number;
  maxCount: number;
}

/** 把会话时间戳聚合成 48 桶直方图；无数据返回 null */
export function buildTimeAxis(entries: TimelineEntry[]): TimeAxis | null {
  if (entries.length === 0) return null;
  const ts = entries.map((e) => e.createdAt);
  const minTs = Math.min(...ts);
  const maxTs = Math.max(...ts);
  const span = maxTs - minTs || 1;
  const counts = new Array<number>(TIMELINE_BUCKETS).fill(0);
  for (const e of entries) {
    const idx = Math.min(
      TIMELINE_BUCKETS - 1,
      Math.floor(((e.createdAt - minTs) / span) * TIMELINE_BUCKETS),
    );
    counts[idx] += 1;
  }
  return { counts, minTs, maxTs, maxCount: Math.max(...counts, 1) };
}

/** 会话 recency：0（最旧）~ 1（最新），时间轴 reveal 对齐用 */
export function recencyOf(createdAt: number, axis: TimeAxis): number {
  return (createdAt - axis.minTs) / (axis.maxTs - axis.minTs || 1);
}

// mulberry32 确定性 PRNG
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

interface StarmapTimelineProps {
  entries: TimelineEntry[];
  /** 0..1，当前揭示进度 */
  reveal: number;
  playing: boolean;
  onReveal: (v: number) => void;
  onTogglePlay: () => void;
}

export function StarmapTimeline({
  entries,
  reveal,
  playing,
  onReveal,
  onTogglePlay,
}: StarmapTimelineProps) {
  const axis = useMemo(() => buildTimeAxis(entries), [entries]);
  const barRef = useRef<HTMLDivElement>(null);

  const stars = useMemo(() => {
    const rnd = mulberry32(0x5eed ^ TIMELINE_BUCKETS);
    return Array.from({ length: 60 }, () => ({
      x: rnd(),
      y: rnd(),
      s: 0.6 + rnd() * 1.2,
    }));
  }, []);

  if (!axis) {
    return (
      <p className="px-1 py-1 text-[11px] text-muted-foreground">
        暂无时间数据 — 新会话后时间轴自动点亮
      </p>
    );
  }

  const scrubTo = (clientX: number) => {
    const el = barRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    onReveal(Math.min(1, Math.max(0, (clientX - r.left) / r.width)));
  };

  const revealedAt = axis.minTs + (axis.maxTs - axis.minTs) * reveal;

  return (
    <div className="select-none">
      <div className="flex items-center gap-2">
        <button
          onClick={onTogglePlay}
          title={playing ? "暂停" : "播放时间轴"}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-white text-[#303030] transition-colors hover:bg-muted"
        >
          {playing ? (
            <Pause className="h-3 w-3" strokeWidth={2} />
          ) : (
            <Play className="h-3 w-3" strokeWidth={2} />
          )}
        </button>

        <div
          ref={barRef}
          className="relative h-8 flex-1 cursor-pointer touch-none overflow-hidden rounded-md border border-border bg-[#0F1220]"
          onPointerDown={(e) => scrubTo(e.clientX)}
          onPointerMove={(e) => {
            if (e.buttons === 1) scrubTo(e.clientX);
          }}
        >
          {stars.map((s, i) => (
            <span
              key={i}
              className="absolute rounded-full bg-white/25"
              style={{
                left: `${s.x * 100}%`,
                top: `${s.y * 100}%`,
                width: s.s,
                height: s.s,
              }}
            />
          ))}
          <div className="absolute inset-x-0 bottom-0 flex items-end gap-[1px] px-[2px]">
            {axis.counts.map((c, i) => {
              const filled = i / TIMELINE_BUCKETS < reveal;
              return (
                <div
                  key={i}
                  className="flex-1 rounded-t-[1px] transition-colors duration-200"
                  style={{
                    height: `${4 + (c / axis.maxCount) * 22}px`,
                    backgroundColor: filled ? "#6366F1" : "#3A4168",
                    opacity: filled ? 0.95 : 0.45,
                  }}
                />
              );
            })}
          </div>
          <div
            className="pointer-events-none absolute bottom-0 top-0 w-[2px] bg-white/80"
            style={{ left: `calc(${reveal * 100}% - 1px)` }}
          />
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between px-1 font-mono text-[10px] text-muted-foreground">
        <span>{fmtDay(axis.minTs)}</span>
        <span className="text-[#6366F1]">{fmtDay(revealedAt)}</span>
        <span>{fmtDay(axis.maxTs)}</span>
      </div>
    </div>
  );
}
