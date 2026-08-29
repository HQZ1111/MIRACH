/**
 * quit-confirm - 关闭确认桥（windowState.ts 非组件层 ↔ QuitConfirmOverlay 弹窗）
 *
 * window.confirm 在 Tauri WebView 里不弹原生对话框（直接返回 falsy），
 * 所以真实模式下有后台任务运行中的关闭确认改走应用内自绘弹窗：
 * initQuitGuard 检测到 running 进程时 preventDefault 并写入本 store，
 * QuitConfirmOverlay 监听展示，用户确认后 resolve(true) → win.destroy()。
 */

import { atom } from "nanostores";

export interface QuitConfirmState {
  /** 运行中的后台任务数（仅用于展示文案） */
  running: number;
  /** 用户选择：true = 确认关闭，false = 取消 */
  resolve: (ok: boolean) => void;
}

export const $quitConfirm = atom<QuitConfirmState | null>(null);
