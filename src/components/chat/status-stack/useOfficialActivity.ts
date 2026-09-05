/**
 * useOfficialActivity — 活动窗口的官方数据源（官方投影优先，mirach store 兜底）
 *
 * 官方内核里活动的真实数据面：
 *   - ctx.sessions.list 快照：jobsBySession（后台任务 /bg，SessionJob：
 *     running|stopping|completed|killed|failed）、subagentsByParent（子代理）
 *   - sessions.binding(dshId).session.projections.faceOf('goal')：目标投影
 *
 * 内核未 boot / 会话未映射时 ready=false，调用方回退 mirach 自有 store
 * （$bgState/$subagentState/$goalState——由 relay 事件管道驱动，两套数据同源
 * 不同视角，取 max 保证角标不漏报）。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { $activeSessionId } from "@/store/session";
import { getApi } from "@/lib/api";
import { nativeGoalProjection, nativeSessionsList } from "@/dsh-kernel/boot";

export interface OfficialActivity {
  /** 官方数据面可用（内核已 boot 且拿到 dsh 会话映射） */
  ready: boolean;
  /** 官方后台任务运行中数（/bg，running|stopping） */
  jobsRunning: number;
  /** 官方子代理数（挂当前会话） */
  subagents: number;
  /** 官方目标活跃（active|waiting） */
  goalActive: boolean;
}

const INITIAL: OfficialActivity = { ready: false, jobsRunning: 0, subagents: 0, goalActive: false };

/** 子代理计数：官方 `subagentsByParent[dshId]` 是目录快照对象
 *  `{ entries: [...], state, error? }`（SubagentCatalogSnapshot），条目在 entries 里 */
function subagentCount(value: unknown): number {
  if (value !== null && typeof value === "object" && Array.isArray((value as { entries?: unknown[] }).entries)) {
    return (value as { entries: unknown[] }).entries.length;
  }
  if (Array.isArray(value)) return value.length;
  return 0;
}

export function useOfficialActivity(): OfficialActivity {
  const activeId = useStore($activeSessionId);
  const [dshId, setDshId] = useState<string | null>(null);
  const [state, setState] = useState<OfficialActivity>(INITIAL);

  // mirach 会话 id → dsh 会话 id（映射缺失 = 官方面不可用）
  useEffect(() => {
    let cancelled = false;
    setDshId(null);
    if (!activeId) return;
    void getApi()
      .getDshSessionId(activeId)
      .then((id) => {
        if (!cancelled) setDshId(id ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // jobs：订阅官方 list 快照（dsh 会话为键）。read() 只写 jobs 字段——
  // goalActive 由下方 goal 投影订阅独立维护，此处覆盖会踩掉目标角标
  useEffect(() => {
    if (!dshId) {
      // 切到无映射会话：归零（上一个会话的活动角标不得带到新会话）
      setState((s) => ({ ...s, ready: false, jobsRunning: 0, subagents: 0, goalActive: false }));
      return;
    }
    const list = nativeSessionsList();
    if (list === null) {
      setState((s) => ({ ...s, ready: false }));
      return;
    }
    const read = (): void => {
      const snap = list.getSnapshot();
      const jobs = snap.jobsBySession?.[dshId] ?? [];
      setState((s) => ({
        ...s,
        ready: true,
        jobsRunning: jobs.filter((j) => j.status === "running" || j.status === "stopping").length,
        subagents: subagentCount(snap.subagentsByParent?.[dshId]),
      }));
    };
    read();
    const unsub = list.subscribe(read);
    return () => {
      unsub();
    };
  }, [dshId]);

  // goal：官方 goal 投影（faceOf('goal')）
  useEffect(() => {
    if (!dshId) {
      // 切到无映射会话：目标角标归零（goal 由下面有映射时的投影订阅维护）
      setState((s) => ({ ...s, goalActive: false }));
      return;
    }
    const face = nativeGoalProjection(dshId);
    if (!face) return;
    const read = (): void => {
      const snap = face.getSnapshot() as { goal?: { phase?: string } | null } | null;
      const phase = snap?.goal?.phase;
      const active = phase === "active" || phase === "waiting";
      setState((s) => ({ ...s, goalActive: active }));
    };
    read();
    const unsub = face.subscribe(read);
    return () => {
      unsub();
    };
  }, [dshId]);

  return state;
}
