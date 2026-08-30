/**
 * chat-events — MirachEvent → chat stores 的统一事件处理器
 *
 * 从 useStreamingReply 抽出（原内联 switch），sidecar 管道与内核管道
 * （VITE_KERNEL）共用同一套 chat store 写入语义——收敛 O-2 双解析器债务。
 * 会话/环境守卫（sidAtSend/epochAtSend）由调用方在分发前完成。
 */

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
import { addArtifacts } from "@/store/artifacts";
import { detectArtifacts } from "@/lib/artifact-detect";
import { speak } from "@/lib/tts";
import { pushConsole } from "@/store/console";
import type { MirachEvent } from "@/lib/api/types";

/** 引擎工具名 → ToolCall.category（未知归 other） */
export function toolCategory(name: string): "edit" | "explore" | "run" | "delegate" | "other" {
  const n = name.toLowerCase();
  if (n.includes("edit") || n.includes("write") || n.includes("patch")) return "edit";
  if (n.includes("read") || n.includes("search") || n.includes("grep") || n.includes("explore")) return "explore";
  if (n.includes("bash") || n.includes("run") || n.includes("exec") || n.includes("terminal")) return "run";
  if (n.includes("delegate") || n.includes("subagent") || n.includes("agent")) return "delegate";
  return "other";
}

/** status.update 降噪：连续相同状态只插入一次 */
let lastStatus = "";

/** 重置状态降噪缓存（新消息开始/回合结束时调用） */
export function resetStatusDedup(): void {
  lastStatus = "";
}

/**
 * 处理一条 MirachEvent 并写入 chat 相关 stores。
 * @param e - 管道事件（sidecar adapter 或内核桥产出，同形）
 * @param opts.sendText - 本次发送的原文（失败重试条用）
 * @param opts.requestSession - 发起请求时的会话 id（busy 桶的键）
 * @param opts.background - 后台簿记模式：发起请求的会话已不是活跃会话
 *   （用户切走了）——转录写入全部跳过（防串台），但 busy 释放/定稿复位/
 *   失败重试条等簿记照常执行（防"回复中"永久卡死）。
 */
export function handleMirachEvent(
  e: MirachEvent,
  opts: { sendText: string; requestSession: string; background?: boolean },
): void {
  const bg = opts.background === true;
  switch (e.type) {
    case "message.start": {
      setAgentBusy(true, opts.requestSession);
      if (bg) break;
      startAiMessage(e.messageId);
      resetStatusDedup();
      pushConsole("event", "AI 回复开始");
      break;
    }
    case "message.delta": {
      if (bg) break; // 后台 delta 不写活跃转录（切回会话后由流式继续/历史补全）
      if (e.partType === "thinking") appendAiThinking(e.messageId, e.delta);
      else appendAiDelta(e.messageId, e.delta);
      break;
    }
    case "message.complete": {
      // 后台也定稿簿记：复位流式/忙碌（不写文本——切回会话时历史重放补全）
      if (bg) {
        finalizeAiMessage(null);
        setAgentBusy(false, opts.requestSession);
        setLastFailedPrompt(null);
        break;
      }
      finalizeAiMessage(e.messageId, e.text, e.engineMessageId);
      resetStatusDedup();
      if (e.text) addArtifacts(detectArtifacts(e.text, opts.requestSession));
      setAgentBusy(false, opts.requestSession);
      setLastFailedPrompt(null);
      if ($autoSpeak.get() && e.text) void speak(e.text);
      pushConsole("event", `消息完成 · ${e.text?.length ?? 0} 字符`);
      break;
    }
    case "message.error": {
      // 后台错误：busy 释放 + 重试条（全局可见），错误详情不写活跃转录
      if (bg) {
        finalizeAiMessage(null);
        setAgentBusy(false, opts.requestSession);
        setLastFailedPrompt(opts.sendText);
        pushConsole("error", e.message);
        break;
      }
      resetStatusDedup();
      finalizeAiMessage(e.messageId || null);
      appendSystemMessage(`⚠️ ${e.message}`);
      setLastFailedPrompt(opts.sendText);
      setAgentBusy(false, opts.requestSession);
      pushConsole("error", e.message);
      break;
    }
    case "tool.start": {
      if (bg) break;
      const payload = {
        name: e.tool.name,
        category: toolCategory(e.tool.name),
        status: "running" as const,
        title: e.tool.detail ?? e.tool.name,
        detail: e.tool.detail,
        args: e.tool.args,
      };
      if ($toolCalls.get().some((c) => c.id === e.tool.id)) {
        updateToolCall(e.tool.id, payload);
      } else {
        addToolCall(payload, e.tool.id, $currentAiId.get() ?? undefined);
      }
      pushConsole("event", `工具开始 · ${e.tool.name}`);
      break;
    }
    case "tool.complete": {
      if (bg) break;
      completeToolCall(e.tool.id, e.tool.status === "error" ? "error" : "completed");
      if (e.tool.result !== undefined) {
        updateToolCall(e.tool.id, { result: e.tool.result });
      }
      break;
    }
    case "tool.update": {
      if (bg) break;
      updateToolCall(e.tool.id, { status: e.tool.status === "error" ? "error" : "running" });
      break;
    }
    case "approval.request": {
      if (bg) break;
      if (requiresApproval()) {
        updateToolCall(e.tool.id, { needsApproval: true });
      } else {
        completeToolCall(e.tool.id, "running");
        pushConsole("info", `自动批准 · ${e.tool.name}`);
      }
      break;
    }
    case "status.update": {
      if (bg) break;
      if (e.status !== lastStatus) {
        lastStatus = e.status;
        appendSystemMessage(`ℹ️ ${e.status}`);
        pushConsole("info", e.status);
      }
      break;
    }
    case "compaction.summary": {
      if (bg) break;
      appendCompactionMessage(e.info);
      break;
    }
    case "user_question": {
      // 引擎提问与活跃会话无关（全局浮层），后台也照常弹出
      setPendingQuestions({
        rpcId: e.rpcId,
        questions: e.questions,
        askedAt: Date.now(),
      });
      break;
    }
    default:
      break;
  }
}
