/**
 * SubagentPanel - 子代理面板（主页活动卡片）
 *
 * 顶部统计（运行/完成/失败 + 总耗时 + 模型数），
 * 下方每个 child agent：名称 + 目标 + 模型 + 耗时。
 * 数据来自 store/subagents（mock 模式由 useMockStatus 播种；
 * 真实模式由后端 subagent.* 事件驱动）。
 */

import { useStore } from "@nanostores/react";
import { Users } from "lucide-react";
import {
  $subagentState,
  type SubagentStatus,
} from "@/store/subagents";
import type { ItemState } from "@/store/composer-status";
import { StatusSection } from "./StatusSection";
import { StatusRow } from "./StatusRow";

function saToItemState(status: SubagentStatus): ItemState {
  switch (status) {
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "error";
  }
}

export function SubagentPanel() {
  const { agents } = useStore($subagentState);
  if (agents.length === 0) return null;

  const counts = agents.reduce<Record<SubagentStatus, number>>(
    (acc, a) => {
      acc[a.status] += 1;
      return acc;
    },
    { running: 0, completed: 0, error: 0 },
  );
  const totalSec = agents.reduce((sum, a) => sum + (a.durationSec ?? 0), 0);
  const models = new Set(agents.map((a) => a.model));

  return (
    <StatusSection
      label="子代理"
      icon={<Users className="h-3.5 w-3.5 text-muted-foreground" />}
      accessory={`${agents.length}`}
    >
      {/* 统计行 */}
      <div className="mb-1 flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <span className="text-[#F59E0B]">运行 {counts.running}</span>
        <span className="text-[#10B981]">完成 {counts.completed}</span>
        <span className="text-[#EF4444]">失败 {counts.error}</span>
        <span className="ml-auto">{totalSec}s · 模型 {models.size}</span>
      </div>

      {agents.map((a) => (
        <StatusRow
          key={a.id}
          state={saToItemState(a.status)}
          title={a.name}
          subtitle={`${a.goal} · ${a.model}`}
          accessory={a.durationSec !== undefined ? `${a.durationSec}s` : undefined}
        />
      ))}
    </StatusSection>
  );
}
