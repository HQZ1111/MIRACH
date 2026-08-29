/**
 * goals - 目标状态 store
 *
 * 四态：active / done / paused / waiting
 * 由解析 agent 输出标记行更新（⊙/✓/⏸/⏳）。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  getSessionData,
  setSessionData,
} from "./session";

// ----------------------------------------------------------------
// 类型
// ----------------------------------------------------------------

export type GoalStatus = "idle" | "active" | "done" | "paused" | "waiting";

export interface SessionGoal {
  status: GoalStatus;
  text: string;
  setAt: number;
}

const DEFAULT_GOAL: SessionGoal = { status: "idle", text: "", setAt: 0 };

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

const $goalMap = makeSessionMap<SessionGoal>();

export const $goalState = computed(
  [$activeSessionId, $goalMap],
  (sessionId, map) => map.get(sessionId) ?? DEFAULT_GOAL,
);

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

export function setGoal(text: string): void {
  const sessionId = $activeSessionId.get();
  setSessionData($goalMap, sessionId, {
    status: "active",
    text,
    setAt: Date.now(),
  });
}

export function updateGoalStatus(status: GoalStatus): void {
  const sessionId = $activeSessionId.get();
  const goal = getSessionData($goalMap, sessionId, DEFAULT_GOAL);
  if (goal.status === "idle") return;
  setSessionData($goalMap, sessionId, { ...goal, status });
}

export function clearGoal(): void {
  const sessionId = $activeSessionId.get();
  setSessionData($goalMap, sessionId, DEFAULT_GOAL);
}
