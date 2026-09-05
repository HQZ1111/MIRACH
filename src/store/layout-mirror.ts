/**
 * layout-mirror — 官方侧栏折叠状态的全局镜像
 *
 * 官方 layout store 在官方树内；AppLayout 的侧栏宽度观察器（ResizeObserver）
 * 把折叠状态写入本 store，MainPanel 据此在主对话区顶栏左侧渲染
 * "展开/新建任务/搜索"图标组（折叠时侧栏本体隐藏、图标移到顶栏）。
 */
import { atom } from "nanostores";

/** 官方侧栏是否处于折叠态（列宽 ≤ 56px 的窄轨判定） */
export const sidebarCollapsed = atom<boolean>(false);

/** 由 AppLayout 宽度观察器同步（侧栏列宽 ≤ 60 → 折叠） */
export function setSidebarCollapsed(collapsed: boolean): void {
  sidebarCollapsed.set(collapsed);
}
