/**
 * official-header — 顶栏标题的官方数据源（工作区名 + 会话名）
 *
 * 顶栏此前用 mirach 自己的会话/项目数据拼标题：活跃会话是**前端 id**，
 * 而官方工作区快照的 sessionIds 是**引擎会话 id**，匹配不上就回落到本地
 * 项目名（"项目 01" 这类 mock 名）；且点官方侧栏切换会话时 mirach 的
 * activeSessionId 不跟随 → 标题不动。
 *
 * 这里直接读官方内核的两个快照源（都是响应式的）：
 *   - sessions.list.current → 当前引擎会话 id
 *   - workspaces.list.items → 工作区（title + sessionIds）
 * 于是标题随官方 current 变化实时更新，且与侧栏 WorkspaceBrowser 同源。
 */

import { useCallback, useSyncExternalStore } from "react";
import { useStore } from "@nanostores/react";
import { $kernelReady } from "@/store/kernel-ready";
import { nativeSessionsList } from "./boot";
import { currentWorkspaceSource } from "./sidebar-shell";

export interface OfficialHeader {
  /** 当前会话所属工作区名（官方 workspaces.list 的 title）；未就绪 null */
  workspaceTitle: string | null;
  /** 当前会话显示名（官方 displayTitle：会话标题 → 项目目录名 → 会话 id） */
  sessionTitle: string | null;
}

const EMPTY: OfficialHeader = { workspaceTitle: null, sessionTitle: null };

function read(): OfficialHeader {
  const sessions = nativeSessionsList();
  const workspaces = currentWorkspaceSource();
  if (sessions === null) return EMPTY;
  const current = sessions.getSnapshot().current;
  if (current === undefined) return EMPTY;
  const summary = sessions.getSnapshot().byId?.[current] as
    | { title?: string; displayTitle?: string }
    | undefined;
  const sessionTitle = summary?.displayTitle ?? summary?.title ?? null;
  const items = workspaces?.getSnapshot()?.items ?? [];
  // 官方侧栏把不属于任何工作区的会话归入"未分组"；这里同口径
  const workspaceTitle = items.find((w) => w.sessionIds.includes(current))?.title ?? "未分组";
  return { workspaceTitle, sessionTitle };
}

/** 快照以 JSON 字符串返回：useSyncExternalStore 按值比较，避免重渲染循环。 */
export function useOfficialHeader(): OfficialHeader {
  const kernelReady = useStore($kernelReady);
  const subscribe = useCallback(
    (onChange: () => void) => {
      const sessions = nativeSessionsList();
      const workspaces = currentWorkspaceSource();
      const disposers = [sessions?.subscribe(onChange), workspaces?.subscribe(onChange)];
      return () => {
        for (const dispose of disposers) dispose?.();
      };
      // kernelReady 变化时源才出现/重建：依赖它强制重建订阅
    },
    // kernelReady 只在源重建时用作信号（订阅体不直接读取）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kernelReady],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(read()),
    () => JSON.stringify(EMPTY),
  );
  return JSON.parse(snapshot) as OfficialHeader;
}
