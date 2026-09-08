/**
 * toast — 轻量全局通知
 *
 * mirach 适配：显示层统一走 hermes 通知中心（store/notifications 的
 * $notifications + NotificationStack，支持置顶堆叠/动作按钮/常驻错误），
 * pushToast 桥接为 hermes notify()——旧调用点零改动，新老通知同一出口。
 */

import { notify } from "@/store/notifications";

export type ToastType = "info" | "success" | "error";

export function pushToast(text: string, type: ToastType = "info", _duration = 2600): void {
  void _duration; // hermes notify 的时长策略接管（error/warning 常驻）
  notify({
    kind: type,
    message: text,
  });
}
