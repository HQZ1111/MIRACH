/**
 * ChatToolButton — 对话区右上角浮动工具按钮（StatusWindow 左侧）
 *
 * 聊天记录（Ctrl+F）/ 详细模式（Ctrl+O）/ 运行轨迹 / Plan 模式。
 * 原 ChatSection 内嵌菜单的迁移版：对话区已换官方树（NativeChatArea），
 * 该按钮挂在 MainPanel 内容区、与 StatusWindow 同排（官方树没有此入口，
 * 属 mirach 自有功能）。会话标签页开关已随 SessionTabs 功能一并删除。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { History, ListTodo, Rows3, Waypoints } from "lucide-react";
import { openChatHistory, $trajectoryRequest } from "@/store/chat-history";
import { $agentMode, setAgentMode } from "@/store/agent";
import { $liveMessages } from "@/store/chat";
import { $toolCalls } from "@/store/tool-calls";
import { TrajectoryOverlay } from "@/components/trajectory/TrajectoryOverlay";

export function ChatToolButton({ detailsExpanded, onToggleDetails }: {
  detailsExpanded: boolean;
  onToggleDetails: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  // 左侧栏「查看调用轨迹」菜单 → 全局请求 → 打开轨迹弹窗
  const trajectoryReq = useStore($trajectoryRequest);
  useEffect(() => {
    if (trajectoryReq > 0) setTrajectoryOpen(true);
  }, [trajectoryReq]);

  // Ctrl+F → 打开"聊天记录"弹窗（微信查找聊天记录样式，替代 inline 查找条）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openChatHistory();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Plan 模式（参考 dsh ui-plan：只分析规划，不修改文件）；
  // 与 Composer 三模式中的「计划模式」全局联动（$agentMode === "plan"）
  const agentMode = useStore($agentMode);
  const planMode = agentMode === "plan";
  const togglePlanMode = () => setAgentMode(planMode ? "workspace" : "plan");
  // 轨迹弹窗数据（hooks 必须无条件调用——不能放在下方 JSX 条件里）
  const msgs = useStore($liveMessages);
  const toolCalls = useStore($toolCalls);

  return (
    <div className="absolute right-[52px] top-3 z-30">
      <button
        onClick={() => setOpen((v) => !v)}
        title="聊天记录工具"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-[#464646] shadow-sm transition-colors hover:bg-muted"
      >
        <History className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="panel-glass menu-anim absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl py-1">
            <button
              onClick={() => {
                setOpen(false);
                openChatHistory();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
            >
              <History className="h-3.5 w-3.5 text-muted-foreground" />
              聊天记录
              <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+F</span>
            </button>
            <button
              onClick={() => {
                setOpen(false);
                onToggleDetails();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
            >
              <Rows3 className="h-3.5 w-3.5 text-muted-foreground" />
              {detailsExpanded ? "简洁模式" : "详细模式"}
              <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+O</span>
            </button>
            {/* 运行轨迹弹窗（参考 deepseek-harness TrajectoryView） */}
            <button
              onClick={() => {
                setOpen(false);
                setTrajectoryOpen(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
            >
              <Waypoints className="h-3.5 w-3.5 text-muted-foreground" />
              运行轨迹
            </button>
            {/* Plan 模式开关（参考 dsh ui-plan；与 Composer 四模式联动） */}
            <button
              onClick={() => {
                setOpen(false);
                togglePlanMode();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
            >
              <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
              {planMode ? "退出 Plan 模式" : "Plan 模式"}
            </button>
          </div>
        </>
      )}
      {trajectoryOpen && (
        <TrajectoryOverlay
          open
          onClose={() => setTrajectoryOpen(false)}
          msgs={msgs}
          toolCalls={toolCalls}
        />
      )}
    </div>
  );
}
