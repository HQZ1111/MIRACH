/**
 * useStreamingReply — 消费流式回复事件（事件形状对齐 zosma-cowork 简约档 useDSHStream）
 *
 * 返回一个函数：submitPromptStream(sessionId, text) 经 Tauri Channel 提交，
 * 事件流按规则写入聊天 store：
 *   message.start    → startAiMessage（记录 messageId，后续 delta/complete 按它定位）
 *   message.delta    → appendAiDelta(id, delta)（增量追加到指定 AI 气泡，工具消息插入不分裂）
 *   message.complete → finalizeAiMessage(id, text)（权威文本替换）+ busy 复位 + 自动朗读
 *   message.error    → 追加系统错误消息 + busy 复位（半成品由前端 Stop 收尾）
 *   tool.start/complete/update → tool-calls store（ToolEntry 卡片，单一渲染路径）
 *   approval.request → 标记工具需审批
 *   status.update    → 追加系统状态消息
 *
 * mock 模式由 MockClient.submitPromptStream 派发演示事件，行为一致。
 */

import { useCallback } from "react";
import { getApi } from "@/lib/api";
import {
  startAiMessage,
  appendAiDelta,
  appendAiThinking,
  appendSystemMessage,
  appendCompactionMessage,
  finalizeAiMessage,
  $autoSpeak,
  $currentAiId,
} from "@/store/chat";
import { addToolCall, completeToolCall, updateToolCall, $toolCalls } from "@/store/tool-calls";
import { setAgentBusy, requiresApproval } from "@/store/agent";
import { setLastFailedPrompt } from "@/store/retry";
import { setPendingQuestions } from "@/store/user-questions";
import { $activeSessionId } from "@/store/session";
import { $envEpoch } from "@/store/environments";
import { addArtifacts } from "@/store/artifacts";
import { detectArtifacts } from "@/lib/artifact-detect";
import { speak } from "@/lib/tts";
import { pushConsole } from "@/store/console";

/** 引擎工具名 → ToolCall.category（未知归 other） */
function toolCategory(name: string): "edit" | "explore" | "run" | "delegate" | "other" {
  const n = name.toLowerCase();
  if (n.includes("edit") || n.includes("write") || n.includes("patch")) return "edit";
  if (n.includes("read") || n.includes("search") || n.includes("grep") || n.includes("explore")) return "explore";
  if (n.includes("bash") || n.includes("run") || n.includes("exec") || n.includes("terminal")) return "run";
  if (n.includes("delegate") || n.includes("subagent") || n.includes("agent")) return "delegate";
  return "other";
}

// status.update 降噪：连续相同状态只插入一次（流式中高频状态避免刷屏）
let lastStatus = "";

export function useStreamingReply(): (sessionId: string, text: string) => Promise<void> {
  return useCallback(async (sessionId: string, text: string) => {
    const api = getApi();
    // 发送时的活跃会话与环境代数：事件到达时若已切走，丢弃迟到事件（防跨会话/跨环境污染）
    const sidAtSend = $activeSessionId.get();
    const epochAtSend = $envEpoch.get();
    // 推理强度不走每消息参数（此前传了也被 RealClient 忽略，纯死路）：
    // 统一由设置页 activeEffort → dsh_set_effort → sidecar diff 重启链路生效
    await api.submitPromptStream(
      sessionId,
      text,
      (e) => {
      if ((sidAtSend && $activeSessionId.get() !== sidAtSend) || $envEpoch.get() !== epochAtSend) return; // 会话/环境已切换：丢弃本流事件
      if (e.type === "message.start") {
        startAiMessage(e.messageId);
        lastStatus = ""; // 新消息开始：重置状态降噪缓存，避免跨消息误吞
        setAgentBusy(true);
        pushConsole("event", "AI 回复开始");
      } else if (e.type === "message.delta") {
        if (e.partType === "thinking") appendAiThinking(e.messageId, e.delta);
        else appendAiDelta(e.messageId, e.delta);
      } else if (e.type === "message.complete") {
        // 权威文本替换（防重复/尾字错误，参考 zosma TEXT_END）
        finalizeAiMessage(e.messageId, e.text, e.engineMessageId);
        lastStatus = ""; // 回合结束重置状态降噪缓存，避免跨回合吞状态行
        // 回复定稿 → 真实检测产物入库（HTML/SVG/代码围栏/链接）
        if (e.text) addArtifacts(detectArtifacts(e.text, sidAtSend || sessionId));
        setAgentBusy(false);
        setLastFailedPrompt(null); // 成功 → 清掉失败重试条
        if ($autoSpeak.get() && e.text) void speak(e.text);
        pushConsole("event", `消息完成 · ${e.text?.length ?? 0} 字符`);
      } else if (e.type === "message.error") {
        lastStatus = "";
        // messageId 缺席时引擎未开始产出——不能用 ""（?? 不拦空串会把空 id 写进 finalizedIds）
        finalizeAiMessage(e.messageId || null); // 保留半成品，仅复位流式状态
        appendSystemMessage(`⚠️ ${e.message}`);
        setLastFailedPrompt(text); // 记录失败提示词 → 对话区重试条
        setAgentBusy(false);
        pushConsole("error", e.message);
      } else if (e.type === "tool.start") {
        const payload = {
          name: e.tool.name,
          category: toolCategory(e.tool.name),
          status: "running" as const,
          title: e.tool.detail ?? e.tool.name,
          detail: e.tool.detail,
          args: e.tool.args,
        };
        // upsert：tool/call 通知与 chunk 流可能各来一次，避免重复卡片/空参数覆盖；
        // messageId 绑定当前流式 AI 消息（工具行按消息归属，不再全挂第一条）
        if ($toolCalls.get().some((c) => c.id === e.tool.id)) {
          updateToolCall(e.tool.id, payload);
        } else {
          addToolCall(payload, e.tool.id, $currentAiId.get() ?? undefined);
        }
        pushConsole("event", `工具开始 · ${e.tool.name}`);
      } else if (e.type === "tool.complete") {
        completeToolCall(e.tool.id, e.tool.status === "error" ? "error" : "completed");
        if (e.tool.result !== undefined) {
          updateToolCall(e.tool.id, { result: e.tool.result });
        }
      } else if (e.type === "tool.update") {
        updateToolCall(e.tool.id, { status: e.tool.status === "error" ? "error" : "running" });
      } else if (e.type === "approval.request") {
        // 模式联动：confirm/plan 需要人工审批；auto/full 自动批准（对应引擎 /yolo）
        if (requiresApproval()) {
          updateToolCall(e.tool.id, { needsApproval: true });
        } else {
          completeToolCall(e.tool.id, "running");
          pushConsole("info", `自动批准 · ${e.tool.name}`);
        }
      } else if (e.type === "status.update") {
        // 降噪：连续相同状态只插入一次（避免流式中高频状态刷屏）
        if (e.status !== lastStatus) {
          lastStatus = e.status;
          appendSystemMessage(`ℹ️ ${e.status}`);
          pushConsole("info", e.status);
        }
      } else if (e.type === "compaction.summary") {
        // 上下文压缩（dsh compaction/summary）→ 对话区压缩标记行（CompactionRow）
        appendCompactionMessage(e.info);
      } else if (e.type === "user_question") {
        // 引擎提问（ask_user_question）→ 暂存待答问题，对话区渲染提问卡
        setPendingQuestions({
          rpcId: e.rpcId,
          questions: e.questions,
          askedAt: Date.now(),
        });
      }
      },
    );
  }, []);
}
