/**
 * session-dialog — 会话对话框状态
 *
 * 「在新窗口打开」/ ⌘⇧N 改为应用内弹窗对话框（不再开独立系统窗口）：
 *  - 左侧栏会话 ⇧⌘+点击 / 右键菜单「在新窗口打开」 → openSessionDialog(id)
 *  - ⌘⇧N → openSessionDialog(null)（空白新会话对话框）
 * AppLayout 订阅该 atom，非空时渲染 SessionDialogOverlay。
 */

import { atom } from "nanostores";

/** 对话框中的会话 id（null = 空白新会话；undefined/关闭 = 不显示） */
export const $sessionDialog = atom<string | null | undefined>(undefined);

export function openSessionDialog(sessionId: string | null): void {
  $sessionDialog.set(sessionId);
}

export function closeSessionDialog(): void {
  $sessionDialog.set(undefined);
}
