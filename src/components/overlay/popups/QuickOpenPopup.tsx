/**
 * QuickOpenPopup — 快速打开弹窗（+），渲染在覆盖层 webview 中
 *
 * 列出面板选项，选择后 emit("overlay:action", { type: "quick", action: "open", id }) 回传主应用。
 */

import type { RefObject } from "react";
import { emit } from "@tauri-apps/api/event";
import { PANELS } from "@/components/layout/rightTabs";
import { OVERLAY_PAD, POPUP_SIZES } from "../events";

interface QuickOpenPopupProps {
  cardRef: RefObject<HTMLDivElement | null>;
}

export function QuickOpenPopup({ cardRef }: QuickOpenPopupProps) {
  return (
    <div
      ref={cardRef}
      className="panel-glass menu-anim absolute rounded-xl py-1"
      style={{ left: OVERLAY_PAD, top: OVERLAY_PAD, width: POPUP_SIZES.quick.w }}
    >
      {PANELS.map((p) => (
        <button
          key={p.id}
          onClick={() => void emit("overlay:action", { type: "quick", action: "open", id: p.id })}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
        >
          <p.icon className="h-4 w-4 shrink-0 text-muted-foreground" weight="fill" />
          <span className="flex-1 truncate">{p.label}</span>
        </button>
      ))}
    </div>
  );
}
