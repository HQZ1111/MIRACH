/**
 * ZoomPopup — 适应窗口下拉（适应窗口 + 50~200%），渲染在覆盖层 webview 中
 *
 * 选择后 emit("overlay:action", { type: "zoom", action: "set", percent }) 回传主应用。
 */

import type { RefObject } from "react";
import { emit } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import { OVERLAY_PAD, POPUP_SIZES, type OverlayZoomPayload } from "../events";

/** 适应百分比选项（最上"适应窗口"= 100%，下面 50~200 步进 25） */
export const BROWSER_ZOOM_LEVELS = [50, 75, 100, 125, 150, 175, 200];

interface ZoomPopupProps extends OverlayZoomPayload {
  cardRef: RefObject<HTMLDivElement | null>;
}

export function ZoomPopup({ percent, cardRef }: ZoomPopupProps) {
  return (
    <div
      ref={cardRef}
      className="panel-glass menu-anim absolute rounded-xl py-1"
      style={{ left: OVERLAY_PAD, top: OVERLAY_PAD, width: POPUP_SIZES.zoom.w }}
    >
      <button
        onClick={() => void emit("overlay:action", { type: "zoom", action: "set", percent: 100 })}
        className={cn(
          "block w-full px-2 py-1 text-left text-body-sm transition-colors hover:bg-muted",
          percent === 100 ? "font-medium text-[#303030]" : "text-[#464646]",
        )}
      >
        适应窗口
      </button>
      <div className="mx-2 my-1 h-px bg-border" />
      {BROWSER_ZOOM_LEVELS.map((p) => (
        <button
          key={p}
          onClick={() => void emit("overlay:action", { type: "zoom", action: "set", percent: p })}
          className={cn(
            "block w-full px-2 py-1 text-left text-body-sm transition-colors hover:bg-muted",
            p === percent ? "font-medium text-[#303030]" : "text-[#464646]",
          )}
        >
          {p}%
        </button>
      ))}
    </div>
  );
}
