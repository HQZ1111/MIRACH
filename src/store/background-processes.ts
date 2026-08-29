/**
 * background-processes - 后台进程 store
 *
 * 从 gateway process.list 同步。
 * 成功 4s / 失败 12s 自动消失。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  updateSessionData,
} from "./session";

export type BackgroundStatus = "running" | "completed" | "failed";

export interface BackgroundProcess {
  id: string;
  name: string;
  status: BackgroundStatus;
  startedAt: number;
  completedAt?: number;
}

interface BgState {
  processes: BackgroundProcess[];
}

const DEFAULT_STATE: BgState = { processes: [] };
const SUCCESS_LINGER_MS = 4000;
const FAIL_LINGER_MS = 12000;

const $bgMap = makeSessionMap<BgState>();

export const $bgState = computed(
  [$activeSessionId, $bgMap],
  (sessionId, map) => map.get(sessionId) ?? DEFAULT_STATE,
);

let idSeq = 0;

export function addBackgroundProcess(name: string): string {
  const id = `bg${Date.now()}_${idSeq++}`;
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $bgMap,
    sessionId,
    (prev) => ({
      processes: [
        ...prev.processes,
        { id, name, status: "running" as const, startedAt: Date.now() },
      ],
    }),
    DEFAULT_STATE,
  );
  return id;
}

export function updateBackgroundStatus(
  id: string,
  status: BackgroundStatus,
): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $bgMap,
    sessionId,
    (prev) => ({
      processes: prev.processes.map((p) =>
        p.id === id
          ? { ...p, status, completedAt: Date.now() }
          : p,
      ),
    }),
    DEFAULT_STATE,
  );
}

export function removeBackgroundProcess(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $bgMap,
    sessionId,
    (prev) => ({
      processes: prev.processes.filter((p) => p.id !== id),
    }),
    DEFAULT_STATE,
  );
}

/** 自动消失计时（成功 4s，失败 12s） */
export function getLingerMs(status: BackgroundStatus): number {
  return status === "failed" ? FAIL_LINGER_MS : SUCCESS_LINGER_MS;
}
