/**
 * StatusStack - 活动状态聚合内容
 *
 * 渲染位置：StatusWindow（对话区右上角浮动窗口）内。
 * 按固定顺序渲染分组：
 *   goal -> todo -> coding -> subagent -> background -> preview -> queue
 *
 * 每个 Panel 自管数据 store，无数据时返回 null，
 * 容器无可见子节点时自动收起（empty:hidden）。
 */

import { cn } from "@/lib/utils";
import { GoalPanel } from "./GoalPanel";
import { TodoPanel } from "./TodoPanel";
import { CodingRow } from "./CodingRow";
import { SubagentPanel } from "./SubagentPanel";
import { BackgroundPanel } from "./BackgroundPanel";
import { PreviewRow } from "./PreviewRow";
import { QueuePanel } from "./QueuePanel";
import { useGitStatus } from "@/hooks/useGitStatus";
import { MOCK } from "@/lib/mock";

export function StatusStack({ className }: { className?: string }) {
  // 真实 Git 状态（branch/增删行/ahead-behind；非仓库则隐藏 CodingRow）
  const git = useGitStatus();

  return (
    <div
      className={cn(
        "flex flex-col gap-1 p-1.5 empty:hidden",
        className,
      )}
    >
      {/* 按固定顺序渲染：goal -> todo -> coding -> subagent -> background -> preview -> queue */}
      <GoalPanel />
      <TodoPanel />
      {git.in_repo && git.branch ? (
        <CodingRow
          branch={git.branch}
          added={git.added}
          removed={git.removed}
          ahead={git.ahead}
          behind={git.behind}
        />
      ) : MOCK ? (
        // mock 模式 check_git_workspace 未注册 → 恒 in_repo=false，回退演示行避免 CodingRow 消失
        <CodingRow branch="main" added={12} removed={4} ahead={2} behind={1} />
      ) : null}
      <SubagentPanel />
      <BackgroundPanel />
      <PreviewRow />
      <QueuePanel />
    </div>
  );
}
