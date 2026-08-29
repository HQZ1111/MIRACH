/**
 * QuitConfirmOverlay — 关闭确认弹窗（真实模式，有后台任务运行中时）
 *
 * $quitConfirm 非空时显示：给出运行中任务数 + 取消/确定关闭。
 * 复用 panel-glass + popup-anim 玻璃弹窗风格（同 BootFailureOverlay），
 * z-[80] 盖在常规浮层之上、StatusWindow 通知（z-[81]）之下。
 */

import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import { $quitConfirm } from "@/store/quit-confirm";

export function QuitConfirmOverlay() {
  const state = useStore($quitConfirm);

  if (!state) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 backdrop-blur-md">
      <div className="absolute inset-0" />
      <div className="panel-glass popup-anim relative w-[440px] rounded-2xl p-6">
        <button
          onClick={() => state.resolve(false)}
          title="取消"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <span className="text-2xl" aria-hidden>⏳</span>
        <h2 className="mt-2 text-member font-bold text-[#303030]">后台任务运行中</h2>
        <p className="mt-1.5 text-body-sm leading-relaxed text-muted-foreground">
          有 {state.running} 个后台任务运行中，确定关闭 Mirach？
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          关闭后正在运行的任务将被终止。
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => state.resolve(false)}
            className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-body-sm font-medium text-[#303030] transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            onClick={() => state.resolve(true)}
            className="flex-1 rounded-md bg-[#303030] px-3 py-2 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            确定关闭
          </button>
        </div>
      </div>
    </div>
  );
}
