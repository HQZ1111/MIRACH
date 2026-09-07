/**
 * Sash — 移植自 hermes desktop（tree-split.tsx 的 Sash）。
 * 纯透明命中区（无视觉子元素）：两栏之间的颜色差异本身就是界线，
 * 不需要额外的线条。非对称抓取：朝前一栏只伸 1px（不挡滚动条），
 * 朝后一栏 7px。双击 = 恢复默认宽度。
 */
export function Sash({
  disabled,
  horizontal,
  onDoubleClick,
  onPointerDown
}: {
  disabled?: boolean;
  horizontal?: boolean;
  onDoubleClick?: () => void;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-mirach-sash
      className={[
        "absolute z-20 [-webkit-app-region:no-drag]",
        horizontal === false
          ? "inset-x-0 top-0 h-[8px] -translate-y-[1px]"
          : "inset-y-0 left-0 w-[8px] -translate-x-[1px]",
        disabled ? "pointer-events-none" : horizontal === false ? "cursor-row-resize" : "cursor-col-resize"
      ].join(" ")}
      onDoubleClick={disabled ? undefined : onDoubleClick}
      onPointerDown={disabled ? undefined : onPointerDown}
      role="separator"
    />
  );
}
