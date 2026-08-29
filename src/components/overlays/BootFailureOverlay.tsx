/**
 * BootFailureOverlay — 引擎启动失败浮层（S3-5，对应原型 boot-failure-overlay）
 *
 * $gatewayState === "error" 时显示：给出失败原因 + 重试 / 打开引擎设置。
 * 可 × 关闭（关闭后右栏网关状态点仍红色提醒，点击可再次触发探测）。
 */

import { useStore } from "@nanostores/react";
import { X } from "lucide-react";
import { $gatewayError } from "@/store/gateway";

interface BootFailureOverlayProps {
  /** 重新探测引擎 */
  onRetry: () => void;
  /** 跳到设置 → Gateway 分区 */
  onOpenSettings: () => void;
  /** 关闭浮层（仅隐藏；状态仍为 error） */
  onClose: () => void;
}

export function BootFailureOverlay({ onRetry, onOpenSettings, onClose }: BootFailureOverlayProps) {
  const error = useStore($gatewayError);

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-md">
      <div className="absolute inset-0" />
      <div className="panel-glass popup-anim relative w-[440px] rounded-2xl p-6">
        <button
          onClick={onClose}
          title="关闭"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>

        <span className="text-2xl" aria-hidden>⚠️</span>
        <h2 className="mt-2 text-member font-bold text-[#303030]">引擎连接失败</h2>
        <p className="mt-1.5 text-body-sm leading-relaxed text-muted-foreground">
          无法连接 Mirach 引擎
          {error ? `：${error}` : "。"}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          sidecar 通常数秒内就绪；若持续失败，请重启应用并查看终端里的 [sidecar] 日志。
        </p>

        <div className="mt-4 flex gap-2">
          <button
            onClick={onRetry}
            className="flex-1 rounded-md bg-[#303030] px-3 py-2 text-body-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            重试
          </button>
          <button
            onClick={onOpenSettings}
            className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-body-sm font-medium text-[#303030] transition-colors hover:bg-muted"
          >
            引擎设置
          </button>
        </div>
      </div>
    </div>
  );
}
