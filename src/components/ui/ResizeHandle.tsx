/**
 * ResizeHandle — 垂直拖拽手柄（调整相邻区域高度）
 *
 * 拖拽语义：向哪边拖，哪边收缩（VS Code 分隔条式）。
 * onDrag(dy)：dy > 0 表示向下拖动。
 */

import { useRef } from "react";

export function ResizeHandle({ onDrag }: { onDrag: (dy: number) => void }) {
  const lastY = useRef(0);
  return (
    <div
      className="group relative shrink-0 cursor-row-resize"
      style={{ height: 6 }}
      onPointerDown={(e) => {
        lastY.current = e.clientY;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.buttons > 0) {
          const dy = e.clientY - lastY.current;
          lastY.current = e.clientY;
          onDrag(dy);
        }
      }}
    >
      {/* 视觉手柄：中央小横条，悬停显示 */}
      <div className="absolute left-1/2 top-1/2 h-[3px] w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100" />
    </div>
  );
}

/**
 * ColumnResizeHandle — 水平拖拽手柄（调整相邻栏宽度）
 *
 * 与 ResizeHandle 同款 pointer-capture 增量语义：
 * onDrag(dx)：dx > 0 表示向右拖动。调用方决定该增量的含义（右拖变宽/变窄）。
 * 通过 style 指定绝对定位（left/top/bottom/width）。
 */
export function ColumnResizeHandle({
  onDrag,
  onDragEnd,
  style,
}: {
  onDrag: (dx: number) => void;
  /** 拖拽结束（松手）回调：调用方在此提交最终值到 React 状态 */
  onDragEnd?: () => void;
  style?: React.CSSProperties;
}) {
  const lastX = useRef(0);
  const accRef = useRef(0);
  const rafRef = useRef(0);
  return (
    <div
      className="group absolute z-20 cursor-col-resize touch-none"
      style={style}
      onPointerDown={(e) => {
        lastX.current = e.clientX;
        accRef.current = 0;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (e.buttons <= 0) return;
        // 增量累计 + rAF 节流：每帧只派发一次 onDrag，避免高频 pointermove 卡顿
        accRef.current += e.clientX - lastX.current;
        lastX.current = e.clientX;
        if (rafRef.current) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0;
          const d = accRef.current;
          accRef.current = 0;
          if (d !== 0) onDrag(d);
        });
      }}
      onPointerUp={() => {
        // 关键：取消待执行帧前，先补发剩余累计位移，避免快拖后松手丢量（拖拽偏离鼠标）
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
        const d = accRef.current;
        accRef.current = 0;
        if (d !== 0) onDrag(d);
        onDragEnd?.();
      }}
    >
      {/* 官方同款拖拽手柄视觉（AppFrame .handle[data-side=details] 的
          12×32 悬浮 pill）：hover / 拖拽时显现，细圆角 + 悬浮填充 + 阴影 */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-8 w-3 -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-[#d1d5db]/70 bg-[#f5f6f8] opacity-0 shadow-[0_0_1px_rgba(0,0,0,0.2),0_0_4px_rgba(0,0,0,0.02),0_12px_32px_rgba(0,0,0,0.08)] transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100" />
    </div>
  );
}
