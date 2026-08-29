/**
 * useGitStatus — 轮询工作区 Git 状态（CodingRow 数据源）
 *
 * 复用 check_git_workspace（branch / added / removed / ahead / behind），
 * 15s 轮询；非 Tauri 环境静默失败。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface GitStatus {
  in_repo: boolean;
  changes: { path: string; status: string; staged: boolean }[];
  error?: string | null;
  branch?: string | null;
  added: number;
  removed: number;
  ahead: number;
  behind: number;
}

const EMPTY: GitStatus = {
  in_repo: false,
  changes: [],
  added: 0,
  removed: 0,
  ahead: 0,
  behind: 0,
};

export function useGitStatus(): GitStatus {
  const [st, setSt] = useState<GitStatus>(EMPTY);

  useEffect(() => {
    let alive = true;
    const load = () => {
      invoke<GitStatus>("check_git_workspace")
        .then((r) => {
          if (alive) setSt(r);
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(load, 15000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, []);

  return st;
}
