/**
 * sessionWindow — 「在新窗口打开」会话
 *
 * 已改为应用内弹窗对话框（不再新开独立系统窗口 / 新标签页）：
 *  - openSessionWindow(id) → openSessionDialog(id)，AppLayout 渲染 SessionDialogOverlay
 *  - id 为 null 时打开空白新会话对话框（⌘⇧N）
 */

import { openSessionDialog } from "@/store/session-dialog";

/**
 * 新窗口打开会话 → 应用内对话框。
 * @param sessionId 会话 id；null 表示空白新会话
 */
export function openSessionWindow(sessionId: string | null): void {
  openSessionDialog(sessionId);
}
