/**
 * retry — 上次发送失败的提示词（错误重试用）
 *
 * useStreamingReply 在 message.error 时记录失败提示词；
 * ChatSection 在输入框上方显示"发送失败 · 重试"条，点重试重新发送。
 */

import { atom } from "nanostores";

export const $lastFailedPrompt = atom<string | null>(null);

export function setLastFailedPrompt(p: string | null): void {
  $lastFailedPrompt.set(p);
}
