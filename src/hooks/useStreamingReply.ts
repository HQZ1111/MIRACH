/**
 * useStreamingReply — 消费流式回复事件（sidecar 管道）
 *
 * 事件写入统一走 store/chat-events.ts 的 handleMirachEvent（内核管道共用同一
 * 处理器，O-2 双解析器已收敛）。本 hook 只保留：发送参数捕获（会话/环境守卫）、
 * raw_session_event 拦截与 raw 事件转发（装配层底座）。
 * mock 模式由 MockClient.submitPromptStream 派发演示事件，行为一致。
 */

import { useCallback } from "react";
import { getApi } from "@/lib/api";
import { $activeSessionId } from "@/store/session";
import { $envEpoch } from "@/store/environments";
import { handleMirachEvent } from "@/store/chat-events";
import { pushRawEvent } from "@/store/session-events";

export function useStreamingReply(): (sessionId: string, text: string) => Promise<void> {
  return useCallback(async (sessionId: string, text: string) => {
    const api = getApi();
    // 发送时的活跃会话与环境代数：事件到达时若已切走，降级为后台簿记
    // （busy 释放/定稿复位照常，转录写入跳过防串台）——不再整体丢弃，
    // 否则切会话后"回复中"永久卡死、错误提示（欠费等）也随之丢失。
    const sidAtSend = $activeSessionId.get();
    const epochAtSend = $envEpoch.get();
    await api.submitPromptStream(
      sessionId,
      text,
      (e) => {
        const active =
          (!sidAtSend || $activeSessionId.get() === sidAtSend) && $envEpoch.get() === epochAtSend;
        // 原始 SessionEvent 透传 → 事件日志 store（装配层/定位器底座）；
        // raw 底座按活跃会话装载，后台事件不喂（切回时历史重放补齐）
        if (e.type === "raw_session_event") {
          if (active) pushRawEvent(e.event.seq ?? e.seq, e.event.type, e.event.data, e.event.time ?? 0);
          return;
        }
        handleMirachEvent(e, {
          sendText: text,
          requestSession: sidAtSend ?? sessionId,
          background: !active,
        });
      },
    );
  }, []);
}
