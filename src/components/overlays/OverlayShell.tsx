/**
 * OverlayShell — 通用全屏抽屉外壳（对应原型 OverlayView）
 *
 * fixed 全屏遮罩 + 居中大面板：标题栏（标题 + 关闭按钮）。
 * 默认 Esc / 遮罩点击也可关闭；closeOnBackdrop / closeOnEsc 置 false 时仅关闭按钮可关。
 */

import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

interface OverlayShellProps {
  /** 面板标题 */
  title: string;
  /** 关闭回调（Esc / 遮罩 / 关闭按钮） */
  onClose: () => void;
  /** 面板内容 */
  children: ReactNode;
  /** 标题右侧附加元素（如按钮） */
  titleExtra?: ReactNode;
  /** 面板宽度（默认 960px） */
  width?: number;
  /** 面板高度（默认 680px） */
  height?: number;
  /** 点击遮罩空白处是否关闭（默认 true） */
  closeOnBackdrop?: boolean;
  /** Esc 键是否关闭（默认 true） */
  closeOnEsc?: boolean;
}

export function OverlayShell({
  title,
  onClose,
  children,
  titleExtra,
  width = 960,
  height = 680,
  closeOnBackdrop = true,
  closeOnEsc = true,
}: OverlayShellProps) {
  // Esc 关闭
  useEffect(() => {
    if (!closeOnEsc) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, closeOnEsc]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
      {/* 遮罩点击关闭（closeOnBackdrop=false 时保留吸墨层但不可关） */}
      {closeOnBackdrop && <div className="absolute inset-0" onClick={onClose} />}
      {/* 面板（玻璃面 + 弹簧入场，对齐 zosma Send feedback 弹窗） */}
      <div
        className="panel-glass popup-anim relative flex flex-col overflow-hidden rounded-2xl"
        style={{ width, height }}
      >
        {/* 标题栏 */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
          <h2 className="text-member font-bold text-[#303030]">{title}</h2>
          {titleExtra && <div className="ml-auto flex items-center gap-2">{titleExtra}</div>}
          <button
            onClick={onClose}
            title="关闭"
            className={cn(
              "ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted",
              titleExtra && "ml-0",
            )}
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {/* 内容区 */}
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
