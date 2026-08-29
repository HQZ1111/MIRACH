/**
 * console - 右侧栏「控制台」日志缓冲（log-tail 数据源）
 *
 * 引擎事件 / 系统动作统一记入环形缓冲（最多 500 行），ConsolePanel 自动滚到末尾。
 * 纯内存，不持久化。
 */

import { atom } from "nanostores";

export interface ConsoleLine {
  id: number;
  time: string;
  level: "info" | "warn" | "error" | "event";
  text: string;
}

const MAX_LINES = 500;

export const $consoleLines = atom<ConsoleLine[]>([]);

let seq = 0;

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function pushConsole(level: ConsoleLine["level"], text: string): void {
  seq += 1;
  const line: ConsoleLine = { id: seq, time: stamp(), level, text };
  $consoleLines.set([...$consoleLines.get().slice(-(MAX_LINES - 1)), line]);
}

export function clearConsole(): void {
  $consoleLines.set([]);
}
