/**
 * NativeStyled — 对话区官方行式组件封装（官方源码直接导入，更新自动跟随）
 *
 * 官方包 exports 开放了 "./src/*" 子路径：mirach 直接 import 官方组件源码
 * （ReasoningRow / TurnNavigator / ContextMeter / GoalBar），数据从 mirach
 * store 组装（与官方目录/投影同源），t 用内核官方词典（nativeLocaleTranslate）。
 * 内核未 boot / 组件不可用时回退 mirach 自有实现（fallback props）。
 *
 * 各官方组件与官方内部依赖（css modules / ui-primitives / clsx）由同一
 * vite 上下文解析——官方更新组件代码时本封装自动跟随。
 */

import { useEffect, useMemo, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { useStore } from "@nanostores/react";
import { getApi } from "@/lib/api";
import { $assemblyProjections } from "@/dsh-assembly/store";
import {
  nativeGoalsRemote,
  nativeGoalProjection,
  nativeLocaleTranslate,
} from "@/dsh-kernel/boot";

type Translate = (key: string, params?: Record<string, unknown>) => string;

/** 官方组件动态导入（vite 子路径；首次转换慢 → 重试 5 次 ×800ms） */
export function useOfficialComponent<P>(
  specifier: string,
  exportName: string,
): ComponentType<P> | null {
  const [comp, setComp] = useState<ComponentType<P> | null>(null);
  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const attempt = (): void => {
      void import(specifier).then(
        (m) => {
          if (cancelled) return;
          const c = (m as Record<string, unknown>)[exportName];
          if (typeof c === "function") {
            setComp(c as ComponentType<P>);
          } else {
            tries += 1;
            if (tries < 5) window.setTimeout(attempt, 800);
          }
        },
        () => {
          if (cancelled) return;
          tries += 1;
          if (tries < 5) window.setTimeout(attempt, 800);
        },
      );
    };
    attempt();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [specifier, exportName]);
  return comp;
}

/** 内核官方词典翻译（'chat' / 'conversation' / 'goal' 等命名空间） */
export function useNativeTranslate(ns: string): Translate | null {
  const [tick, setTick] = useState(0);
  const t = useMemo(() => nativeLocaleTranslate(ns), [tick]);
  useEffect(() => {
    if (t) return;
    const timer = window.setTimeout(() => setTick((v) => v + 1), 1200);
    return () => window.clearTimeout(timer);
  }, [t]);
  return t;
}

// ── ReasoningRow（思考折叠行） ────────────────────────────────────────────────

interface ReasoningRowProps {
  text: string;
  running: boolean;
  t: Translate;
}

export function NativeReasoningRow({ text, running, fallback }: { text: string; running: boolean; fallback: ReactNode }) {
  const C = useOfficialComponent<ReasoningRowProps>(
    "@deepseek-ai/dsh-client-ui-chat/src/client/chat/ReasoningRow.tsx",
    "ReasoningRow",
  );
  const t = useNativeTranslate("chat");
  if (C === null || t === null) return <>{fallback}</>;
  return <C text={text} running={running} t={t} />;
}

// ── TurnNavigator（消息定位器） ───────────────────────────────────────────────

export interface NativeTurnItem {
  turn: number;
  anchorKey: string;
  prompt: string;
  response: string;
}interface TurnNavigatorProps {
  items: readonly NativeTurnItem[];
  activeTurn: number | null;
  onNavigate: (item: NativeTurnItem) => void;
  t: Translate;
}

export function NativeTurnNavigator({
  items,
  activeTurn,
  onNavigate,
  fallback,
}: {
  items: readonly NativeTurnItem[];
  activeTurn: number | null;
  onNavigate: (item: NativeTurnItem) => void;
  fallback: ReactNode;
}) {
  const C = useOfficialComponent<TurnNavigatorProps>(
    "@deepseek-ai/dsh-client-ui-chat/src/client/chat/TurnNavigator.tsx",
    "TurnNavigator",
  );
  const t = useNativeTranslate("chat");
  if (C === null || t === null) return <>{fallback}</>;
  return <C items={items} activeTurn={activeTurn} onNavigate={onNavigate} t={t} />;
}

// ── ContextMeter（上下文占用环，官方输入框同款） ──────────────────────────────

interface ContextMeterProps {
  useProjection: (key: string) => unknown;
  t: Translate;
}

export function NativeContextMeter({ fallback }: { fallback: ReactNode }) {
  const C = useOfficialComponent<ContextMeterProps>(
    "@deepseek-ai/dsh-client-ui-conversation/src/client/skeleton/ContextMeter.tsx",
    "ContextMeter",
  );
  const t = useNativeTranslate("conversation");
  const assembly = useStore($assemblyProjections);
  // 官方 ContextMeter 期望标准投影钩子：mirach 装配层折叠值与官方
  // contextPressure/contextBreakdown 投影同源（StatsLine 同源消费）
  const useProjection = useMemo(() => {
    return (key: string): unknown => {
      if (key === "contextPressure") return assembly.contextPressure;
      if (key === "contextBreakdown") return assembly.contextBreakdown;
      return undefined;
    };
  }, [assembly]);
  if (C === null || t === null) return <>{fallback}</>;
  return <C useProjection={useProjection} t={t} />;
}

// ── GoalBar（会话目标栏，官方 ui-goal） ───────────────────────────────────────

interface NativeGoalSnapshot {
  id: string;
  revision: number;
  objective: string;
  phase: string;
  maxGoalRounds: number;
}

interface GoalBarComponentProps {
  goal: NativeGoalSnapshot | null | undefined;
  onEdit: (objective: string) => Promise<unknown>;
  onPause: () => Promise<unknown>;
  onResume: () => Promise<unknown>;
  onClear: () => Promise<unknown>;
  t: Translate;
}

const NO_GOAL_RESULT = {
  ok: false,
  error: { code: "no-current-goal", message: "no current goal to mutate", details: {} },
} as const;

export function NativeGoalBar({ sessionId, fallback }: { sessionId: string; fallback?: ReactNode }) {
  const C = useOfficialComponent<GoalBarComponentProps>(
    "@deepseek-ai/dsh-client-ui-goal/src/client/GoalBar.tsx",
    "GoalBar",
  );
  const t = useNativeTranslate("goal");

  // 官方 goal 投影（session.projections.faceOf('goal')）：目标 + CAS ref
  const [projection, setProjection] = useState<{
    goal: NativeGoalSnapshot | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | null = null;
    setProjection(null);
    void (async () => {
      const dshId = await getApi().getDshSessionId(sessionId);
      if (cancelled || !dshId) return;
      const face = nativeGoalProjection(dshId);
      if (!face) return;
      const read = (): void => {
        if (cancelled) return;
        const snap = face.getSnapshot() as { goal?: NativeGoalSnapshot | null } | null | undefined;
        setProjection(snap === null ? null : { goal: snap?.goal ?? null });
      };
      unsub = face.subscribe(read);
      read();
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [sessionId]);

  // mutation 动词：CAS ref 取投影当前值（官方同语义：RPC 的 CAS 是守卫）
  const verbs = useMemo(() => {
    return {
      onEdit: async (objective: string): Promise<unknown> => {
        const dshId = await getApi().getDshSessionId(sessionId);
        const face = dshId ? nativeGoalProjection(dshId) : null;
        const proj = face?.getSnapshot() as { goal?: NativeGoalSnapshot } | null | undefined;
        const remote = nativeGoalsRemote();
        if (!dshId || !proj?.goal || !remote) {
          const err = !dshId || !proj?.goal
            ? NO_GOAL_RESULT
            : { ok: false, error: { code: "unavailable", message: "kernel remote unavailable", details: {} } };
          return err;
        }
        return remote.edit(dshId, { id: proj.goal.id, revision: proj.goal.revision }, { objective });
      },
      onPause: async (): Promise<unknown> => {
        const dshId = await getApi().getDshSessionId(sessionId);
        const face = dshId ? nativeGoalProjection(dshId) : null;
        const proj = face?.getSnapshot() as { goal?: NativeGoalSnapshot } | null | undefined;
        const remote = nativeGoalsRemote();
        if (!dshId || !proj?.goal || !remote) return NO_GOAL_RESULT;
        return remote.pause(dshId, { id: proj.goal.id, revision: proj.goal.revision });
      },
      onResume: async (): Promise<unknown> => {
        const dshId = await getApi().getDshSessionId(sessionId);
        const face = dshId ? nativeGoalProjection(dshId) : null;
        const proj = face?.getSnapshot() as { goal?: NativeGoalSnapshot } | null | undefined;
        const remote = nativeGoalsRemote();
        if (!dshId || !proj?.goal || !remote) return NO_GOAL_RESULT;
        return remote.resume(dshId, { id: proj.goal.id, revision: proj.goal.revision });
      },
      onClear: async (): Promise<unknown> => {
        const dshId = await getApi().getDshSessionId(sessionId);
        const face = dshId ? nativeGoalProjection(dshId) : null;
        const proj = face?.getSnapshot() as { goal?: NativeGoalSnapshot } | null | undefined;
        const remote = nativeGoalsRemote();
        if (!dshId || !proj?.goal || !remote) return NO_GOAL_RESULT;
        return remote.clear(dshId, { id: proj.goal.id, revision: proj.goal.revision });
      },
    };
  }, [sessionId]);

  if (C === null || t === null) return <>{fallback}</>;
  return <C goal={projection === null ? null : projection.goal} {...verbs} t={t} />;
}

/** 官方投影面订阅辅助（useSyncExternalStore 包装；未开放 face 时返回 undefined） */
export function useOfficialProjection<T>(face: { getSnapshot: () => unknown; subscribe: (fn: () => void) => () => void } | null): T | undefined {
  return useSyncExternalStore(
    (fn: () => void) => (face === null ? () => {} : face.subscribe(fn)),
    () => face?.getSnapshot(),
  ) as T | undefined;
}
