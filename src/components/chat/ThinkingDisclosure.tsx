/**
 * ThinkingDisclosure - 思考过程折叠块
 *
 * 流式时自动展开预览（max-h-40，pin 底部显示最新 token）。
 * 完成后显示 "Thought for Ns"。
 * 空内容则隐藏。
 */

import { useState, useEffect, useRef } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

export function ThinkingDisclosure({
  content,
  durationSec,
  isStreaming = false,
  detailsExpanded,
}: {
  content: string;
  durationSec?: number;
  isStreaming?: boolean;
  /** 全局详细模式（Ctrl+O）：定义时优先于本地展开（与 ToolEntry 双层控制一致） */
  detailsExpanded?: boolean;
}) {
  const [open, setOpen] = useState(isStreaming);
  // 全局可控时全局优先，否则用本地展开状态
  const showAll = detailsExpanded !== undefined ? detailsExpanded : open;
  const scrollRef = useRef<HTMLDivElement>(null);

  // 最新一句（参考 zosma ThinkingBlock latestThought）：折叠态只显示最后一行，避免思考刷屏
  const lines = content.trim().split(/\n+/).filter(Boolean);
  const latest = lines[lines.length - 1] ?? content;
  const preview = latest.length > 160 ? `…${latest.slice(-160)}` : latest;

  // 流式时自动滚动到底部
  useEffect(() => {
    if (open && isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content, open, isStreaming]);

  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="group/row flex items-center gap-1.5 py-0.5 text-body-sm text-muted-foreground transition-colors hover:text-[#464646]"
      >
        <Brain className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
        <span>思考过程</span>
        {isStreaming ? (
          <span className="text-xs text-blue-500">思考中...</span>
        ) : (
          durationSec !== undefined && (
            <span className="text-xs text-muted-foreground/60">Thought for {durationSec}s</span>
          )
        )}
        <span className="opacity-0 transition-opacity group-hover/row:opacity-100">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>
      {showAll ? (
        <div
          ref={scrollRef}
          className="ml-5 mb-1 mt-1 max-h-40 overflow-y-auto rounded-lg bg-muted/30 p-2.5"
        >
          <p className="whitespace-pre-wrap text-body-sm leading-relaxed text-muted-foreground">
            {content}
          </p>
        </div>
      ) : (
        content && (
          <p className="ml-5 mb-1 mt-0.5 truncate text-body-sm text-muted-foreground/70" title={content}>
            {preview}
          </p>
        )
      )}
    </div>
  );
}
