/**
 * dsh-assembly/store — 装配引擎的 nanostores 出口
 *
 * $rawEvents（session-events.ts）是唯一事件入口；本模块把引擎视图暴露成
 * 原子供 React 组件消费：
 *   - $assemblyTimeline    Turn/Step 时间线快照（定位器/轨迹/轮导航底座）
 *   - $assemblyProjections 四投影视图（StatsLine/ContextMeter 数据源）
 * 引擎只 bump 引用变化的原子，流式 chunk 高频事件不会引发无效重渲染。
 *
 * @module dsh-assembly/store
 */

import { atom } from "nanostores";
import { AssemblyEngine, type AssemblyProjections } from "./engine";
import type { ConversationTimelineSnapshot } from "./conversation-locations";
import type { DshSessionEvent } from "./events";

export const $assemblyTimeline = atom<ConversationTimelineSnapshot>({ turnOrder: [], turns: new Map() });
export const $assemblyProjections = atom<AssemblyProjections>({});

const engine = new AssemblyEngine();

function publish(): void {
  const timeline = engine.snapshotTimeline();
  if ($assemblyTimeline.get() !== timeline) $assemblyTimeline.set(timeline);
  const projections = engine.snapshotProjections();
  const current = $assemblyProjections.get();
  if (current.sessionStats !== projections.sessionStats
    || current.tokenUsage !== projections.tokenUsage
    || !shallowEqual(current.contextPressure, projections.contextPressure)
    || !shallowEqual(current.contextBreakdown, projections.contextBreakdown)) {
    $assemblyProjections.set(projections);
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ka = Object.keys(a as Record<string, unknown>);
  const kb = Object.keys(b as Record<string, unknown>);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => ra[k] === rb[k]);
}

/**
 * 摄入一批事件（实时单条与历史批量共用；调用方保证同会话内 seq 单调）。
 * 会话切换后由 resetAssembly() 复位，首次摄入自动走整窗重建。
 */
export function ingestAssemblyEvents(events: readonly DshSessionEvent[]): void {
  if (events.length === 0) return;
  engine.ingest(events);
  publish();
}

/** 会话切换/清空：引擎与两个原子全部复位。 */
export function resetAssembly(): void {
  engine.reset();
  publish();
}
