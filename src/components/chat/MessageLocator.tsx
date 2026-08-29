/**
 * MessageLocator — 消息定位器组件
 *
 * 收起态：导轨 9 个横线 ↔ 弹窗可视区 9 条消息（一一对应，非区域制）。
 *         弹窗滚动时，横线对应的消息随可视区更新（横线跟随内容滚动）。
 * 展开态（hover 导轨）：弹窗出现在导轨左侧垂直居中：
 * - 可视区 9 行（行高 25px），内容全部消息可滚动（overflow-y-auto）
 * - 每行 = 纯预览文字，hover/选中背景高亮
 * - 移出后 140ms 延迟关闭 + 过渡动画；打开时定位器区域滚轮作用于弹窗
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CustomScrollbar } from "@/components/ui/CustomScrollbar";

interface MessageLocatorProps {
  /** 可定位的消息（索引 + 显示文本） */
  messages: { index: number; text: string }[];
  /** 当前激活（可见）的消息索引 */
  activeIndex: number;
  /** 点击跳转到指定消息 */
  onJump: (index: number) => void;
  /** 弹窗手动滚动时同步激活消息（黑线跟随弹窗，不消失） */
  onActiveChange?: (index: number) => void;
}

// 弹窗关闭延迟
const HOVER_CLOSE_MS = 140;
// 行高（导轨横线行高与弹窗行高一致）
const ROW_H = 25;
// 可视行数（导轨横线数 = 弹窗可视消息数）
const VISIBLE_ROWS = 12;
// 弹窗可视区高度 = 12 行 + 上下留白
const POPUP_HEIGHT = ROW_H * VISIBLE_ROWS + 16;

export function MessageLocator({ messages, activeIndex, onJump, onActiveChange }: MessageLocatorProps) {
  // 上次点击选中的消息（持久固定，滚动内容区时位置不变）
  const selected = activeIndex;
  // 弹窗打开状态（hover 导轨打开，移出 140ms 延迟关闭）
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  // 首次打开后保留行 DOM，关闭淡出动画仍有内容
  const [everOpened, setEverOpened] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;
  // 弹窗可视区顶部消息索引（导轨横线 ↔ 可视区 9 条消息）
  const [visibleStart, setVisibleStart] = useState(0);
  // 程序滚动标记（activeIndex 驱动的滚动不反向同步，避免循环）
  const programmaticRef = useRef(false);

  // activeIndex 变化（消息区 scrollspy/点击）→ 弹窗滚动到该消息可见，黑线始终显示且位置正确
  // activeIndex 是消息数组下标，需换算成 messages 数组序号（弹窗行位置）
  useEffect(() => {
    const popup = contentRef.current;
    if (!popup || !open) return;
    const idx = messages.findIndex((m) => m.index === activeIndex);
    if (idx < 0) return;
    programmaticRef.current = true;
    popup.scrollTop = Math.min(
      Math.max(0, idx * ROW_H),
      popup.scrollHeight - popup.clientHeight,
    );
    // 同步更新可视区（不依赖 scroll 事件）；rAF 恢复标记（scroll 事件是微任务先消费）
    const maxStart = Math.max(0, messages.length - VISIBLE_ROWS);
    setVisibleStart(Math.min(maxStart, Math.round(popup.scrollTop / ROW_H)));
    const raf = requestAnimationFrame(() => {
      programmaticRef.current = false;
    });
    return () => cancelAnimationFrame(raf);
  }, [activeIndex, open, messages.length]);

  // 弹窗滚动 → 更新可视区顶部索引；用户手动滚动时同步激活消息（黑线跟随弹窗不消失）
  // 依赖 open：弹窗打开前 popupRef 为 null，打开后重新绑定监听
  useEffect(() => {
    const popup = contentRef.current;
    if (!popup || !open) return;
    const update = () => {
      const maxStart = Math.max(0, messages.length - VISIBLE_ROWS);
      const start = Math.min(maxStart, Math.round(popup.scrollTop / ROW_H));
      setVisibleStart(start);
      if (programmaticRef.current) {
        // 程序滚动（activeIndex 驱动）：只更新可视区，不反向同步
        programmaticRef.current = false;
        return;
      }
      // 手动滚动：同步激活消息（转回消息数组下标，与 scrollspy 一致）
      onActiveChange?.(messages[start]?.index ?? 0);
    };
    update();
    popup.addEventListener("scroll", update, { passive: true });
    return () => popup.removeEventListener("scroll", update);
  }, [messages.length, onActiveChange, open]);

  // 弹窗打开时：定位器区域内的滚轮全部作用于弹窗（导轨上滚轮也能滚动弹窗）
  useEffect(() => {
    const root = rootRef.current;
    const popup = contentRef.current;
    if (!root || !popup) return;
    const handler = (e: WheelEvent) => {
      if (!openRef.current) return; // 弹窗未打开时不拦截
      e.preventDefault();
      popup.scrollTop += e.deltaY;
    };
    root.addEventListener("wheel", handler, { passive: false });
    return () => root.removeEventListener("wheel", handler);
  }, []);

  const keepOpen = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
    if (!everOpened) setEverOpened(true);
  };

  const closeSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  // 横线样式（半圆胶囊；选中变深变宽）
  const dotClass = (isSelected: boolean) =>
    cn(
      "rounded-full transition-all duration-150",
      isSelected ? "h-1.5 w-3 bg-[#303030]" : "h-1.5 w-2 bg-[#8B8C8F]/50",
    );

  return (
    <div ref={rootRef} className="relative" onMouseEnter={keepOpen} onMouseLeave={closeSoon}>
      {/* ---- 收起态导轨：9 个横线 ↔ 弹窗可视区 9 条消息 ---- */}
      <div className="flex flex-col items-center py-1">
        {Array.from({ length: VISIBLE_ROWS }, (_, k) => {
          const msg = messages[visibleStart + k];
          return (
            <button
              key={k}
              onClick={() => msg && onJump(msg.index)}
              title={msg?.text}
              className="flex h-[25px] w-7 shrink-0 cursor-pointer items-center justify-end pr-1"
            >
              <span className={dotClass(msg ? msg.index === selected : false)} />
            </button>
          );
        })}
      </div>

      {/* ---- 弹窗（导轨左侧、垂直居中、左侧滚动条、上下留白、纯文字行） ---- */}
      <div
        className={cn(
          "panel-glass absolute right-full top-1/2 z-50 flex w-80 max-w-[320px] -translate-y-1/2 items-stretch rounded-xl py-2 pl-1.5 pr-2 shadow-md transition-[opacity,transform] duration-100 ease-out",
          open
            ? "pointer-events-auto opacity-100 translate-x-0"
            : "pointer-events-none translate-x-1 opacity-0",
        )}
        style={{ height: POPUP_HEIGHT }}
      >
        {/* 左侧滚动条（细线轨道 + 空心圆 thumb，常显） */}
        <CustomScrollbar
          scrollRef={contentRef}
          alwaysVisible
          widthClassName="w-1.5"
          className="shrink-0 self-stretch"
        />
        {/* 内容（原生滚动，隐藏原生滚动条） */}
        <div
          ref={contentRef}
          className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {everOpened &&
            messages.map((m) => (
              <button
                key={m.index}
                onClick={() => onJump(m.index)}
                className={cn(
                  "block w-full min-w-0 max-w-full cursor-pointer select-none overflow-hidden rounded-md px-2 py-1 text-left transition-colors",
                  m.index === selected ? "bg-muted" : "hover:bg-muted/60",
                )}
                style={{ height: ROW_H }}
              >
                <span className="block w-full min-w-0 truncate text-body-sm leading-snug text-[#303030]">
                  {m.text}
                </span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
