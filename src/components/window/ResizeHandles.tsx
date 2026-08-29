/**
 * ResizeHandles — 窗口边缘缩放手柄（无边框透明窗专属）
 *
 * 装饰被移除后，系统缩放热区落在窗口最外圈数像素的透明带里，抓不到。
 * 这里在面板四边/四角铺 10px/14px 的隐形拖拽热区，按下即进入系统级
 * 调整大小流程（最大化时拖拽会先还原窗口再缩放，同系统原生行为）。
 *
 * 手柄位置按"窗口外框到屏幕工作区的原始间隙"定位：最大化的窗口外框
 * 会超出可见屏幕 8px（系统隐形边框落在屏幕外），若按视口边缘定位手柄
 * 会落到屏幕外——间隙为负时向内补偿，保证手柄始终贴在可见屏幕边缘。
 */
import { useEffect, useState, type MouseEvent } from "react";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WINDOW_SHADOW_MARGIN } from "@/lib/constants";

type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
import { appendSystemMessage } from "@/store/chat";
import { MOCK } from "@/lib/mock";
import { useWindowMaximized } from "@/hooks/use-window-maximized";
import { cn } from "@/lib/utils";


export function ResizeHandles() {
  const maximized = useWindowMaximized();
  if (MOCK || maximized) return null; // 铺满时不要手柄（面板已占满桌面工作区）

  // 窗口外框到屏幕工作区四边的原始间隙（逻辑像素；最大化时为负）
  const [gaps, setGaps] = useState({ gT: WINDOW_SHADOW_MARGIN, gR: WINDOW_SHADOW_MARGIN, gB: WINDOW_SHADOW_MARGIN, gL: WINDOW_SHADOW_MARGIN });

  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const update = async (): Promise<void> => {
      try {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const mon = await currentMonitor();
        if (!mon || !alive) return;
        const sf = mon.scaleFactor || 1;
        const wa = mon.workArea;
        setGaps({
          gL: Math.round((pos.x - wa.position.x) / sf),
          gT: Math.round((pos.y - wa.position.y) / sf),
          gR: Math.round((wa.position.x + wa.size.width - (pos.x + size.width)) / sf),
          gB: Math.round((wa.position.y + wa.size.height - (pos.y + size.height)) / sf),
        });
      } catch {
        /* ignore */
      }
    };
    void update();
    const u1 = win.onMoved(() => void update());
    const u2 = win.onResized(() => void update());
    return () => {
      alive = false;
      void u1.then((u) => u());
      void u2.then((u) => u());
    };
  }, []);

  const start = (dir: ResizeDirection) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const win = getCurrentWindow();
    void (async () => {
      try {
        // 最大化时拖边缘 = 系统原生行为：先还原，再进入缩放
        if (await win.isMaximized()) await win.toggleMaximize();
      } catch {
        /* ignore */
      }
      try {
        await win.startResizeDragging(dir);
      } catch (err: unknown) {
        appendSystemMessage(`⚠️ 缩放手柄(${dir})调用失败：${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  };

  // 手柄条居中于面板可视边缘：悬浮（间隙≥40）→ 内缩 40−3；
  // 贴边（间隙≈0）→ 内缩 2px；间隙为负（最大化外框超出）→ 内缩 |间隙|+2
  const inset = (g: number): number => (g < 0 ? -g + 2 : Math.max(2, Math.min(WINDOW_SHADOW_MARGIN, g) - 3));
  const edge = "fixed z-[60]";
  return (
    <>
      {/* 左右 */}
      <div aria-hidden className={cn(edge, "cursor-ew-resize")} style={{ left: inset(gaps.gL), width: 10, top: 0, bottom: 0 }} onMouseDown={start("West")} />
      <div aria-hidden className={cn(edge, "cursor-ew-resize")} style={{ right: inset(gaps.gR), width: 10, top: 0, bottom: 0 }} onMouseDown={start("East")} />
      {/* 上下 */}
      <div aria-hidden className={cn(edge, "cursor-ns-resize")} style={{ top: inset(gaps.gT), height: 10, left: 0, right: 0 }} onMouseDown={start("North")} />
      <div aria-hidden className={cn(edge, "cursor-ns-resize")} style={{ bottom: inset(gaps.gB), height: 10, left: 0, right: 0 }} onMouseDown={start("South")} />
      {/* 四角 */}
      <div aria-hidden className={cn(edge, "cursor-nwse-resize")} style={{ left: inset(gaps.gL), top: inset(gaps.gT), width: 14, height: 14 }} onMouseDown={start("NorthWest")} />
      <div aria-hidden className={cn(edge, "cursor-nesw-resize")} style={{ right: inset(gaps.gR), top: inset(gaps.gT), width: 14, height: 14 }} onMouseDown={start("NorthEast")} />
      <div aria-hidden className={cn(edge, "cursor-nesw-resize")} style={{ left: inset(gaps.gL), bottom: inset(gaps.gB), width: 14, height: 14 }} onMouseDown={start("SouthWest")} />
      <div aria-hidden className={cn(edge, "cursor-nwse-resize")} style={{ right: inset(gaps.gR), bottom: inset(gaps.gB), width: 14, height: 14 }} onMouseDown={start("SouthEast")} />
    </>
  );
}
