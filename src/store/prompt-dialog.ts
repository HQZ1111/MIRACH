/**
 * prompt-dialog - 文本输入弹窗桥（任意组件层 ↔ PromptDialogOverlay 弹窗）
 *
 * window.prompt 在 Tauri WebView 里不弹原生对话框（直接返回 null），
 * 所以所有需要文本输入的交互改走应用内自绘弹窗：
 * 调用方 await openPrompt(...) 拿输入值，弹窗组件监听 $promptDialog 展示。
 */

import { atom } from "nanostores";

export interface PromptOptions {
  /** 弹窗标题 */
  title: string;
  /** 输入框上方的说明文字（可选） */
  label?: string;
  /** 初始值（预填） */
  initialValue?: string;
  /** 输入框占位符 */
  placeholder?: string;
  /** 确定按钮文字，默认「确定」 */
  confirmText?: string;
  /** 取消按钮文字，默认「取消」 */
  cancelText?: string;
  /** 用户结果：字符串 = 确定，null = 取消 */
  resolve: (value: string | null) => void;
}

export const $promptDialog = atom<PromptOptions | null>(null);

/** 打开输入弹窗，返回 Promise<string | null>（null = 取消） */
export function openPrompt(opts: Omit<PromptOptions, "resolve">): Promise<string | null> {
  return new Promise((resolve) => {
    $promptDialog.set({ ...opts, resolve });
  });
}
