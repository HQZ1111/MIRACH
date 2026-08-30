/**
 * useQueueAutoDrain - 队列自动排空
 *
 * Agent 空闲 + 队列有消息 + 未停车时，
 * 延迟 300ms 后自动发送队首。
 *
 * 在 MainPanel 中调用（保证整个生命周期挂载）。
 */

import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { $agentBusy, setAgentBusy, sendMessage } from "@/store/agent";
import { $activeSessionId } from "@/store/session";
import { $queueState, drainFirst } from "@/store/queue";

const AUTO_DRAIN_DELAY_MS = 300;

export function useQueueAutoDrain() {
  const busy = useStore($agentBusy);
  const queueState = useStore($queueState);
  const { items, parked } = queueState;
  const hasItems = items.length > 0;

  useEffect(() => {
    // 忙 / 停车 / 无消息 -> 不排空
    if (busy || parked || !hasItems) return;

    const timer = window.setTimeout(() => {
      const item = drainFirst();
      if (!item) return;
      // 发送前先置忙：堵住「drain 已弹出但引擎 busy 未置位」的并发窗口
      // （真实模式 busy 要等 message.start 事件，引擎响应 >300ms 时若不等会连发多条）。
      // 忙桶键 = 排空目标会话（当前活跃会话）
      const sid = $activeSessionId.get() ?? undefined;
      setAgentBusy(true, sid);
      const ok = sendMessage(item.text);
      if (!ok) setAgentBusy(false, sid); // 无发送处理器：回滚忙标记，避免队列卡死
    }, AUTO_DRAIN_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [busy, parked, hasItems]);
}
