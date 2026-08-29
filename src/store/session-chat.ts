/**
 * session-chat — 按会话隔离的 mock 聊天消息（VITE_MOCK=1 演示模式）
 *
 * mock 模式下每个会话维护独立的消息列表（从空开始，不播种假消息）：
 *  - Composer / 澄清问答等发送的用户消息追加到当前会话；
 *  - 接真实后端后由 chat.ts（$liveMessages + 引擎会话 id）替代。
 */

import { atom } from "nanostores";

export interface SessionChatMsg {
  role: "user" | "ai" | "system";
  text: string;
  time: string;
  systemType?: "steer" | "slash" | "plain";
}

/** 会话 id → 消息列表（内存缓存；可订阅副本用于触发重渲染） */
const cache = new Map<string, SessionChatMsg[]>();
export const $sessionChat = atom(new Map<string, SessionChatMsg[]>());

/** 读取指定会话的消息（首次访问建空列表并缓存） */
export function getSessionChat(sessionId: string, _title: string): SessionChatMsg[] {
  const cached = cache.get(sessionId);
  if (cached) return cached;
  const list: SessionChatMsg[] = [];
  cache.set(sessionId, list);
  $sessionChat.set(new Map(cache));
  return list;
}

/** 追加消息到指定会话（保证会话消息存在；通知订阅者） */
function push(sessionId: string, msg: SessionChatMsg): void {
  getSessionChat(sessionId, "新会话");
  const list = cache.get(sessionId)!;
  // 不可变更新：必须返回新数组引用，否则 MessageList（memo 浅比较）bail out，
  // mock 模式发送的消息永远不显示
  const next = [...list, msg];
  cache.set(sessionId, next);
  $sessionChat.set(new Map(cache));
}

/** 当前时间（HH:mm） */
function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function appendSessionUserMessage(sessionId: string, text: string): void {
  push(sessionId, { role: "user", text, time: nowTime() });
}

export function appendSessionAiMessage(sessionId: string, text: string): void {
  push(sessionId, { role: "ai", text, time: nowTime() });
}

export function appendSessionSystemMessage(
  sessionId: string,
  text: string,
  systemType?: "steer" | "slash" | "plain",
): void {
  push(sessionId, { role: "system", text, time: nowTime(), systemType });
}
