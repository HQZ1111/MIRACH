/**
 * overlay 事件契约 — 主应用 ⇄ 覆盖层 webview 的通信协议
 *
 * 覆盖层是一个透明的原生 child webview（在浏览器 webview 之后创建，z 序更高），
 * 浏览器区域弹窗渲染在其中，真正盖住浏览器。
 *
 * 事件流：
 *   - 主应用 emit("overlay:show", payload) → 覆盖层渲染弹窗
 *   - 主应用 emit("overlay:hide")           → 覆盖层清空（主应用负责 hide webview）
 *   - 覆盖层 emit("overlay:action", action) → 主应用执行动作（切标签/应用缩放等）
 *   - 覆盖层 emit("overlay:close")          → 弹窗要求关闭（Esc / 失焦 / 点卡片外）
 */

import type { TabItem } from "@/components/layout/rightTabs";

/** 弹窗类型 */
export type OverlayPopupType = "tabs" | "zoom" | "quick";

/** 弹窗卡片外留白（阴影/圆角外透出下层内容；覆盖层 bounds = 卡片 ± 此值） */
export const OVERLAY_PAD = 12;

/** 各弹窗卡片尺寸（覆盖层初开时用；实际尺寸由覆盖层测量后 overlay_resize 校准） */
export const POPUP_SIZES: Record<OverlayPopupType, { w: number; h: number }> = {
  tabs: { w: 280, h: 380 },
  zoom: { w: 96, h: 252 },
  quick: { w: 176, h: 152 },
};

/** 标签下拉载荷 */
export interface OverlayTabsPayload {
  tabs: TabItem[];
  recent: TabItem[];
  activeTab: string | null;
}

/** 适应窗口下拉载荷 */
export interface OverlayZoomPayload {
  percent: number;
}

/** overlay:show 载荷 */
export interface OverlayShowPayload {
  type: OverlayPopupType;
  tabs?: OverlayTabsPayload;
  zoom?: OverlayZoomPayload;
}

/** overlay:action 载荷（type + 具体动作） */
export interface OverlayActionPayload {
  type: OverlayPopupType;
  /** tabs: switch | close | reopen；zoom: set；quick: open */
  action: string;
  /** tabs 的目标标签 id / quick 的面板 id */
  id?: string;
  /** zoom 的目标百分比 */
  percent?: number;
}
