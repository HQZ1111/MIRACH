/**
 * ConfirmDialog — 危险操作确认弹窗（参考 zosma confirm-dialog）
 *
 * - 红色图标瓦片 + 脉冲光环（1.6s 循环，强化"危险"语义）
 * - 取消按钮排第一并默认获得焦点（防误按 Enter）
 * - 确认按钮 destructive 色（hover 提亮）
 * 用于替换 window.confirm / window.alert。
 */

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "确认",
  cancelLabel = "取消",
  icon,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 图标（默认 Trash2，可传其他） */
  icon?: React.ReactNode;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // 打开时取消按钮获得初始焦点（防误 Enter 触发危险操作）
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => cancelRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="w-[380px] max-w-[calc(100vw-48px)] border-border/60 bg-card">
        <DialogHeader className="flex flex-col items-center gap-3 text-center sm:text-center">
          {/* 图标瓦片 + 脉冲光环 */}
          <div className="relative flex h-12 w-12 items-center justify-center">
            {/* 光环 */}
            <span
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-[#EF4444]/20"
              style={{ animation: "confirm-pulse 1.6s ease-out infinite" }}
            />
            <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[#EF4444]/12 text-[#EF4444]">
              {icon ?? (
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              )}
            </span>
          </div>
          <div className="space-y-1.5">
            <DialogTitle className="text-base font-semibold text-[#303030]">{title}</DialogTitle>
            <DialogDescription className="text-[13px] leading-relaxed text-muted-foreground">
              {description}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* 按钮：取消在前并获得初始焦点 */}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="rounded-md bg-muted/60 px-3 py-1.5 text-[12px] font-medium text-[#464646] transition-colors hover:bg-muted"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-1.5 rounded-md bg-[#EF4444] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:brightness-110 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
