/**
 * TabsPopup — 标签页下拉弹窗（▾），渲染在覆盖层 webview 中
 *
 * 搜索 / 打开的标签页 / 最近关闭（最多 9）。交互通过 emit("overlay:action") 回传主应用执行。
 */

import { useState, type RefObject } from "react";
import { emit } from "@tauri-apps/api/event";
import { MagnifyingGlass, X } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import { PANEL_ICON } from "@/components/layout/rightTabs";
import { OVERLAY_PAD, POPUP_SIZES, type OverlayTabsPayload } from "../events";

interface TabsPopupProps extends OverlayTabsPayload {
  /** 卡片元素 ref（覆盖层测量实际尺寸用） */
  cardRef: RefObject<HTMLDivElement | null>;
}

export function TabsPopup({ tabs, recent, activeTab, cardRef }: TabsPopupProps) {
  const [query, setQuery] = useState("");
  const filteredTabs = tabs.filter((t) => !query || t.label.includes(query));
  const filteredRecent = recent.filter((t) => !query || t.label.includes(query));

  const act = (action: string, id?: string) =>
    void emit("overlay:action", { type: "tabs", action, id });

  return (
    <div
      ref={cardRef}
      className="panel-glass menu-anim absolute flex flex-col rounded-xl"
      style={{
        left: OVERLAY_PAD,
        top: OVERLAY_PAD,
        width: POPUP_SIZES.tabs.w,
        height: POPUP_SIZES.tabs.h,
      }}
    >
      {/* 搜索标签页 */}
      <div className="relative p-2.5 pb-1.5">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索标签页…"
          className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2.5 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
        />
        <MagnifyingGlass className="absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      </div>

      {/* 打开的标签页 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">打开的标签页</p>
        {filteredTabs.length === 0 ? (
          <p className="px-1 pb-1 text-[11px] text-muted-foreground/60">暂无</p>
        ) : (
          filteredTabs.map((t) => {
            const Icon = PANEL_ICON[t.id];
            return (
              <button
                key={t.id}
                onClick={() => act("switch", t.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm transition-colors hover:bg-muted",
                  activeTab === t.id ? "bg-muted text-[#303030]" : "text-[#303030]",
                )}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" weight="fill" />}
                <span className="flex-1 truncate">{t.label}</span>
                <X
                  className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60 transition-colors hover:text-[#303030]"
                  weight="bold"
                  onClick={(e) => {
                    e.stopPropagation();
                    act("close", t.id);
                  }}
                />
              </button>
            );
          })
        )}
      </div>

      {/* 最近关闭的标签页（滚动，最多 9） */}
      <div className="min-h-0 flex-1 border-t border-border px-2.5 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <p className="px-1 pb-1 text-[11px] text-muted-foreground">最近关闭的标签页</p>
        {filteredRecent.length === 0 ? (
          <p className="px-1 pb-1 text-[11px] text-muted-foreground/60">暂无</p>
        ) : (
          filteredRecent.map((t) => {
            const Icon = PANEL_ICON[t.id];
            return (
              <button
                key={t.id}
                onClick={() => act("reopen", t.id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" weight="fill" />}
                <span className="flex-1 truncate">{t.label}</span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
