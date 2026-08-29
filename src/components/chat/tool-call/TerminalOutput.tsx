/**
 * TerminalOutput - 只读终端输出查看器（stdout/stderr 渲染）
 *
 * 特性：
 *  - 等宽、不换行：长行横向滚动，保留输出原始布局；
 *  - 高度上限 + 纵向滚动；
 *  - 打开时跳到末尾（ResizeObserver 首次回调，布局期读 scrollHeight）；
 *  - 内容增长时仅在用户已贴底时跟随（往上读旧输出不被拽回去）。
 *
 * 任何需要展示命令输出/日志的地方都可直接复用。
 */

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

interface TerminalOutputProps {
  className?: string;
  text: string;
  maxHeightClass?: string;
}

const NEAR_BOTTOM_PX = 24;

export function TerminalOutput({ className, text, maxHeightClass = "max-h-40" }: TerminalOutputProps) {
  const ref = useRef<HTMLDivElement>(null);
  const jumpedRef = useRef(false);

  // 打开时跳到最新输出（仅首次；后续 resize 不得把用户拽回底部）
  useEffect(() => {
    const el = ref.current;
    if (el && !jumpedRef.current) {
      jumpedRef.current = true;
      el.scrollTop = el.scrollHeight;
    }
    // 依赖空：仅挂载时跳一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 内容增长：仅在已贴底时跟随
  useEffect(() => {
    const el = ref.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX) {
      el.scrollTop = el.scrollHeight;
    }
  }, [text]);

  return (
    <div
      ref={ref}
      className={cn(
        "overflow-auto overscroll-contain rounded-md bg-[#0d1117]",
        maxHeightClass,
        className,
      )}
    >
      <pre className="w-max min-w-full whitespace-pre font-mono text-[11px] leading-[15px] text-[#c9d1d9]">
        {text}
      </pre>
    </div>
  );
}
