/**
 * subagents - 子代理 store
 *
 * child agent 信息：目标、模型、耗时、活动。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  updateSessionData,
} from "./session";

export type SubagentStatus = "running" | "completed" | "error";

export interface Subagent {
  id: string;
  name: string;
  goal: string;
  model: string;
  status: SubagentStatus;
  startedAt: number;
  durationSec?: number;
  /** 引擎 childSessionId（subagent.started 携带；finished 按它匹配收尾） */
  engineId?: string;
}

interface SubState {
  agents: Subagent[];
}

const DEFAULT_STATE: SubState = { agents: [] };

const $subMap = makeSessionMap<SubState>();

export const $subagentState = computed(
  [$activeSessionId, $subMap],
  (sessionId, map) => map.get(sessionId) ?? DEFAULT_STATE,
);

let idSeq = 0;

export function addSubagent(
  name: string,
  goal: string,
  model: string,
  engineId?: string,
): string {
  const id = engineId ?? `sa${Date.now()}_${idSeq++}`;
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $subMap,
    sessionId,
    (prev) => ({
      agents: [
        ...prev.agents,
        { id, name, goal, model, status: "running" as const, startedAt: Date.now(), ...(engineId ? { engineId } : {}) },
      ],
    }),
    DEFAULT_STATE,
  );
  return id;
}

export function updateSubagentStatus(
  id: string,
  status: SubagentStatus,
): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $subMap,
    sessionId,
    (prev) => ({
      agents: prev.agents.map((a) =>
        (a.id === id || a.engineId === id)
          ? {
              ...a,
              status,
              durationSec: Math.round((Date.now() - a.startedAt) / 1000),
            }
          : a,
      ),
    }),
    DEFAULT_STATE,
  );
}

export function removeSubagent(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $subMap,
    sessionId,
    (prev) => ({
      agents: prev.agents.filter((a) => a.id !== id),
    }),
    DEFAULT_STATE,
  );
}
