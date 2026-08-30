/**
 * dsh-assembly/engine — mirach 前端装配引擎
 *
 * 职责对应官方的「Session Controller 事件窗口 → 装配/投影」一段：
 * 把 $rawEvents 里的原始 SessionEvent（实时透传 + get_history 历史解包，
 * seq 单调）驱动成 Turn/Step 时间线（ConversationLocationIndex）与四个
 * 投影视图（sessionStats/tokenUsage/contextPressure/contextBreakdown）。
 *
 * 水位策略：
 *   - 已应用 seq 记入 applied 集合（历史批量与实时流重叠时天然去重）；
 *   - 新 seq 高于水位 → 增量应用（边界事件走 appendBoundary，其余
 *     appendNonBoundary，与官方 assembler 同一套分类）；
 *   - 出现低于水位的缺失 seq（迟到回填）→ 整窗重建（rebuild + 从头折叠）。
 *
 * @module dsh-assembly/engine
 */

import {
  ConversationLocationIndex,
  type SessionEventEntry,
} from "./location-index";
import {
  applyContextBreakdown,
  applyContextPressure,
  applySessionStats,
  applyTokenUsage,
  initContextBreakdown,
  initContextPressure,
  initSessionStats,
  initTokenUsage,
  viewContextPressure,
  viewSessionStats,
  type ContextBreakdownProjection,
  type ContextBreakdownState,
  type ContextPressureProjection,
  type ContextPressureState,
  type SessionStatsProjection,
  type SessionStatsState,
  type TokenUsageProjection,
  type TokenUsageState,
} from "./projections";
import type { ConversationTimelineSnapshot } from "./conversation-locations";
import type { DshSessionEvent } from "./events";

/** 四个投影视图的只读快照（未产生的投影键缺省）。 */
export interface AssemblyProjections {
  readonly sessionStats?: SessionStatsProjection;
  readonly tokenUsage?: TokenUsageProjection;
  readonly contextPressure?: ContextPressureProjection;
  readonly contextBreakdown?: ContextBreakdownProjection;
}

/** Turn/Step 边界事件（timeline 用 appendBoundary，其余 appendNonBoundary）。 */
function isBoundaryEvent(event: DshSessionEvent): boolean {
  return event.type === "turn/start" || event.type === "turn/end"
    || event.type === "step/start" || event.type === "step/end";
}

export class AssemblyEngine {
  private timeline = new ConversationLocationIndex();
  private stats: SessionStatsState = initSessionStats();
  private usage: TokenUsageState = initTokenUsage();
  private pressure: ContextPressureState = initContextPressure();
  private breakdown: ContextBreakdownState = initContextBreakdown();
  /** 已应用事件的 seq（历史/实时重叠去重）。 */
  private applied = new Set<number>();
  /** 已应用的最高 seq（水位）。 */
  private lastSeq: number | null = null;
  /** 会话统计视图缓存（state 引用未变则返回同一视图，避免每事件无效 set）。 */
  private statsViewRef: SessionStatsState | null = null;
  private statsView: SessionStatsProjection | undefined;

  /** 当前时间线快照（引用稳定）。 */
  snapshotTimeline(): ConversationTimelineSnapshot {
    return this.timeline.snapshot();
  }

  /** 当前投影视图快照。 */
  snapshotProjections(): AssemblyProjections {
    if (this.statsViewRef !== this.stats) {
      this.statsViewRef = this.stats;
      this.statsView = viewSessionStats(this.stats);
    }
    return {
      sessionStats: this.statsView,
      tokenUsage: this.usage.totals,
      contextPressure: viewContextPressure(this.pressure),
      contextBreakdown: {
        systemTokens: this.breakdown.systemTokens,
        toolsTokens: this.breakdown.toolsTokens,
        messageTokens: this.breakdown.messageTokens,
      },
    };
  }

  /** 会话切换/清空：全部复位（时间线索引一并重建，防旧 Turn 残留）。 */
  reset(): void {
    this.timeline = new ConversationLocationIndex();
    this.stats = initSessionStats();
    this.usage = initTokenUsage();
    this.pressure = initContextPressure();
    this.breakdown = initContextBreakdown();
    this.applied.clear();
    this.lastSeq = null;
  }

  /**
   * 摄入一批按 seq 升序的事件（$rawEvents 列表即此形态）。
   * 空引擎 + 批量 → 整窗重建；否则增量应用，检出迟到回填时整窗重建。
   */
  ingest(events: readonly DshSessionEvent[]): void {
    if (events.length === 0) return;
    if (this.lastSeq === null && this.applied.size === 0) {
      this.rebuildAll(events);
      return;
    }
    let resync = false;
    for (const event of events) {
      if (!this.isIngestable(event)) continue;
      if (this.applied.has(event.seq)) continue;
      this.applied.add(event.seq);
      if (this.lastSeq !== null && event.seq < this.lastSeq) {
        resync = true;
        continue;
      }
      this.applyOne(event);
      this.lastSeq = this.lastSeq === null ? event.seq : Math.max(this.lastSeq, event.seq);
    }
    if (resync) this.rebuildAll(events);
  }

  /** 事件基本形态校验（缺 seq 的行不是会话事件）。 */
  private isIngestable(event: DshSessionEvent): boolean {
    return event != null && typeof event === "object"
      && typeof event.seq === "number" && Number.isSafeInteger(event.seq)
      && typeof event.type === "string";
  }

  /** 单事件应用（时间线 + 四折叠）。 */
  private applyOne(event: DshSessionEvent): void {
    if (isBoundaryEvent(event)) {
      try {
        this.timeline.appendBoundary(event);
      } catch {
        // 边界序列异常（旧日志/跨会话混杂）：按非边界处理，时间线不中断
        this.timeline.appendNonBoundary(event);
      }
    } else {
      this.timeline.appendNonBoundary(event);
    }
    this.stats = applySessionStats(this.stats, event);
    this.usage = applyTokenUsage(this.usage, event);
    this.pressure = applyContextPressure(this.pressure, event);
    this.breakdown = applyContextBreakdown(this.breakdown, event);
  }

  /** 整窗重建：折叠状态从头重放，时间线一次 rebuild。 */
  private rebuildAll(events: readonly DshSessionEvent[]): void {
    this.timeline = new ConversationLocationIndex();
    this.stats = initSessionStats();
    this.usage = initTokenUsage();
    this.pressure = initContextPressure();
    this.breakdown = initContextBreakdown();
    this.applied.clear();
    this.lastSeq = null;
    const valid = events.filter((e) => this.isIngestable(e));
    const entries: SessionEventEntry[] = [];
    for (const event of valid) {
      this.applied.add(event.seq);
      this.lastSeq = this.lastSeq === null ? event.seq : Math.max(this.lastSeq, event.seq);
      entries.push({ event });
      this.stats = applySessionStats(this.stats, event);
      this.usage = applyTokenUsage(this.usage, event);
      this.pressure = applyContextPressure(this.pressure, event);
      this.breakdown = applyContextBreakdown(this.breakdown, event);
    }
    try {
      this.timeline.rebuild(entries);
    } catch (err) {
      console.warn("[dsh-assembly] timeline rebuild failed:", err);
    }
  }
}
