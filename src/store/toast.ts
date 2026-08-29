/**
 * toast — 轻量全局通知（替换 window.alert 的信息提示）
 */

import { atom } from "nanostores";

export interface Toast {
  id: number;
  text: string;
  type: "info" | "success" | "error";
}

export const $toasts = atom<Toast[]>([]);

let seq = 0;

export function pushToast(text: string, type: Toast["type"] = "info", duration = 2600): void {
  const id = ++seq;
  $toasts.set([...$toasts.get(), { id, text, type }]);
  window.setTimeout(() => {
    $toasts.set($toasts.get().filter((t) => t.id !== id));
  }, duration);
}
