/**
 * useTerminalStatus — 后台终端运行状态
 *
 * 轮询 Rust 侧 list_terminals（每 3 秒），返回所有终端实例
 * 及其真实进程运行状态（try_wait 检测，非界面标签数量）。
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface TerminalStatusInfo {
  id: string;
  running: boolean;
}

interface TerminalStatusContextValue {
  terminals: TerminalStatusInfo[];
  runningCount: number;
}

const TerminalStatusContext = createContext<TerminalStatusContextValue>({
  terminals: [],
  runningCount: 0,
});

export function TerminalStatusProvider({ children }: { children: ReactNode }) {
  const [terminals, setTerminals] = useState<TerminalStatusInfo[]>([]);

  useEffect(() => {
    let disposed = false;
    const poll = async () => {
      try {
        const list = await invoke<TerminalStatusInfo[]>("list_terminals");
        if (!disposed) setTerminals(list);
      } catch {
        /* 非 Tauri 环境或命令失败时忽略 */
      }
    };
    poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  const runningCount = terminals.filter((t) => t.running).length;

  return (
    <TerminalStatusContext.Provider value={{ terminals, runningCount }}>
      {children}
    </TerminalStatusContext.Provider>
  );
}

export function useTerminalStatus() {
  return useContext(TerminalStatusContext);
}
