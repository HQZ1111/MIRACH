/**
 * CustomScrollbar — 通用自定义滚动条（统一样式：细线轨道 + 空心圆 thumb）
 *
 * - 绑定目标滚动容器（scrollRef），thumb 位置实时跟随
 * - 滚动时显示，静止 1500ms 自动隐藏
 * - 按住空心圆可拖动快速滚动
 * - 样式入令牌：轨道 --color-border，thumb #303030 50% 透明度
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CustomScrollbarProps {
  /** 目标滚动容器 ref */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  /** 定位类（如 absolute right-1 top-2 bottom-2） */
  className?: string;
  /** 拖动区域宽度（默认 w-3） */
  widthClassName?: string;
  /** 透传样式（如数值高度） */
  style?: React.CSSProperties;
  /** 常显模式：不自动隐藏（定位器用，参考原型 ThreadTimeline 固定导轨） */
  alwaysVisible?: boolean;
}

export function CustomScrollbar({
  scrollRef,
  className,
  widthClassName = "w-3",
  style,
  alwaysVisible = false,
}: CustomScrollbarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState(0);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollHeight - el.clientHeight;
      setThumb(max > 0 ? (el.scrollTop / max) * 100 : 0);
      if (max <= 0) {
        // 内容不超出一屏：不显示滚动条
        setVisible(false);
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        return;
      }
      if (alwaysVisible) {
        // 常显模式：内容可滚时一直显示，不自动隐藏
        setVisible(true);
        if (timer.current !== undefined) window.clearTimeout(timer.current);
        return;
      }
      setVisible(true);
      if (timer.current !== undefined) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setVisible(false), 2000);
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
      if (timer.current !== undefined) window.clearTimeout(timer.current);
    };
  }, [scrollRef]);

  // 拖动空心圆快速滚动
  const handleMove = (e: React.PointerEvent) => {
    if (e.buttons > 0) {
      const el = scrollRef.current;
      const track = trackRef.current;
      if (!el || !track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      el.scrollTop = ratio * (el.scrollHeight - el.clientHeight);
    }
  };

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative cursor-pointer transition-opacity duration-300",
        widthClassName,
        visible ? "opacity-100" : "opacity-0",
        className,
      )}
      style={style}
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={handleMove}
    >
      {/* 细线轨道 */}
      <div className="absolute left-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border" />
      {/* 空心圆 thumb（50% 透明度） */}
      <div
        className="absolute left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border-2 border-[#303030]/50 bg-white shadow-sm active:cursor-grabbing"
        style={{ top: thumb + "%" }}
      />
    </div>
  );
}
