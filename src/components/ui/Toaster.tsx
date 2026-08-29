/**
 * Toaster — 全局通知浮层（底部居中，自动消失）
 */

import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { $toasts } from "@/store/toast";

export function Toaster() {
  const toasts = useStore($toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[200] flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium shadow-md",
            t.type === "error" && "bg-[#EF4444] text-white",
            t.type === "success" && "bg-[#10B981] text-white",
            t.type === "info" && "bg-[#303030] text-white",
          )}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
