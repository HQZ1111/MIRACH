/**
 * DelegateCard - 子代理委派卡片
 *
 * 列出 child agent 的目标、模型、耗时、实时活动。
 */

import { Users, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { ToolCall } from "@/store/tool-calls";

export function DelegateCard({ call }: { call: ToolCall }) {
  const [expanded, setExpanded] = useState(true);

  // 解析 detail 中的子代理信息（模拟）
  const childAgents = call.detail
    ? [
        {
          name: "Research Agent",
          goal: call.detail.split("\n")[0] || call.title,
          model: "kimi-k2",
          duration: call.durationSec,
        },
      ]
    : [];

  return (
    <div className="ml-8 rounded-lg border border-black/5 bg-muted/20 p-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-1.5"
      >
        <span className="text-muted-foreground/60">
          {expanded ? (
            <ChevronDown className="h-3 w-3" />
          ) : (
            <ChevronRight className="h-3 w-3" />
          )}
        </span>
        <Users className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
        <span className="text-body-sm text-muted-foreground">{call.title}</span>
        {call.durationSec !== undefined && (
          <span className="ml-auto text-[11px] text-muted-foreground/60">
            {call.durationSec}s
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-1.5 space-y-1.5">
          {childAgents.map((agent, i) => (
            <div key={i} className="rounded bg-white/60 p-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[12px] font-medium text-[#303030]">
                  {agent.name}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  · {agent.model}
                </span>
                {agent.duration !== undefined && (
                  <span className="ml-auto text-[11px] text-muted-foreground/60">
                    {agent.duration}s
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">{agent.goal}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
