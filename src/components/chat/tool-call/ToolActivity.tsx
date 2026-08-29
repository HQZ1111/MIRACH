/**
 * ToolActivity — 工具调用友好摘要（参考 zosma ActivityBlock / statusLabels）
 *
 * 普通用户视角：把裸工具名/路径翻译成友好短语（"编辑文件"、"运行命令"…），
 * 连续同类工具合并计数，展示"AI 正在做什么"，而不是技术细节列表。
 * 技术细节仍由 ToolEntry 提供（Ctrl+O 可全局展开）。
 */

import { Wrench } from "lucide-react";
import type { ToolCall } from "@/store/tool-calls";

/** 工具调用 → 友好短语（按 category 与名称推断，绝不暴露裸路径/命令） */
export function friendlyToolPhrase(call: ToolCall): string {
  const n = call.name.toLowerCase();
  if (call.category === "edit") return "编辑文件";
  if (call.category === "explore") return "查看文件";
  if (call.category === "run") {
    if (n.includes("test")) return "运行测试";
    if (n.includes("build")) return "构建项目";
    return "运行命令";
  }
  if (call.category === "delegate") return "委派子代理";
  return "执行工具";
}

export function ToolActivity({ calls }: { calls: ToolCall[] }) {
  if (calls.length === 0) return null;
  // 连续同类合并计数
  const groups: { phrase: string; running: boolean; count: number }[] = [];
  for (const c of calls) {
    const phrase = friendlyToolPhrase(c);
    const last = groups[groups.length - 1];
    if (last && last.phrase === phrase) {
      last.count += 1;
      if (c.status === "running") last.running = true;
    } else {
      groups.push({ phrase, running: c.status === "running", count: 1 });
    }
  }
  return (
    <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {groups.map((g, i) => (
        <span key={i} className="flex items-center gap-1 text-body-sm text-muted-foreground">
          <Wrench className="h-3 w-3 shrink-0" strokeWidth={2} />
          <span>{g.running ? `${g.phrase}中…` : g.phrase}</span>
          {g.count > 1 && (
            <span className="text-[11px] tabular-nums text-muted-foreground/60">×{g.count}</span>
          )}
        </span>
      ))}
    </div>
  );
}
