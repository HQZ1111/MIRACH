/**
 * ToolEntry - 单个工具调用行
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │  [glyph] [icon]  title          +24/-8   5s    ▸    │
 *   ├──────────────────────────────────────────────────────┤
 *   │  detail (stdout/diff/etc.)                          │
 *   ├──────────────────────────────────────────────────────┤
 *   │  [ApprovalBar: Run / Reject]                        │
 *   └──────────────────────────────────────────────────────┘
 */

import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FileEdit,
  Search,
  SquareTerminal,
  Users,
  Wrench,
  ChevronDown,
  ChevronRight,
  Check,
  AlertCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolCall, ToolCallCategory, ToolCallStatus } from "@/store/tool-calls";
import { approveToolCall, rejectToolCall } from "@/store/tool-calls";
import { useAppConfig } from "@/hooks/useAppConfig";
import { TerminalOutput } from "./TerminalOutput";
import { GeneratedImage } from "../GeneratedImage";

// ----------------------------------------------------------------
// 类别图标
// ----------------------------------------------------------------

const CATEGORY_ICONS: Record<ToolCallCategory, LucideIcon> = {
  edit: FileEdit,
  explore: Search,
  run: SquareTerminal,
  delegate: Users,
  other: Wrench,
};

// ----------------------------------------------------------------
// 状态 glyph
// ----------------------------------------------------------------

function StatusGlyph({ status }: { status: ToolCallStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case "completed":
      return <Check className="h-3.5 w-3.5 text-green-500" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-red-500" />;
    case "warning":
      return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
  }
}

// ----------------------------------------------------------------
// 审批条
// ----------------------------------------------------------------

function ApprovalBar({ call }: { call: ToolCall }) {
  return (
    <div className="ml-8 mt-0.5 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
      <span className="text-[12px] text-amber-700">需要批准</span>
      {call.detail && (
        <code className="truncate text-[11px] text-amber-600">{call.detail}</code>
      )}
      <div className="ml-auto flex gap-1">
        <button
          onClick={() => rejectToolCall(call.id)}
          className="rounded px-2 py-0.5 text-[12px] font-medium text-red-600 transition-colors hover:bg-red-100"
        >
          拒绝
        </button>
        <button
          onClick={() => approveToolCall(call.id)}
          className="rounded bg-green-600 px-2 py-0.5 text-[12px] font-medium text-white transition-colors hover:bg-green-700"
        >
          运行
        </button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// ToolEntry
// ----------------------------------------------------------------

export function ToolEntry({
  call,
  detailsExpanded,
}: {
  call: ToolCall;
  /** 全局详细模式（Ctrl+O）：定义时优先于本地展开（参考 zosma 双层控制） */
  detailsExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const showDetail = detailsExpanded !== undefined ? detailsExpanded : expanded;
  const { config } = useAppConfig();
  const Icon = CATEGORY_ICONS[call.category];
  const hasDetail = !!call.detail;

  return (
    <div className="group/tool flex flex-col">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors",
          hasDetail && "hover:bg-muted",
        )}
      >
        {/* 状态 glyph */}
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <StatusGlyph status={call.status} />
        </span>

        {/* 类别图标 */}
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />

        {/* 标题 */}
        <span className="min-w-0 flex-1 truncate text-body-sm text-muted-foreground">
          {call.title}
        </span>

        {/* diff 统计（edit 类别） */}
        {call.diffStats && (
          <span className="shrink-0 text-[11px] font-mono">
            <span className="text-green-600">+{call.diffStats.added}</span>
            <span className="text-red-500"> -{call.diffStats.removed}</span>
          </span>
        )}

        {/* 耗时 */}
        {call.durationSec !== undefined && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            {call.durationSec}s
          </span>
        )}

        {/* 展开 chevron */}
        {hasDetail && (
          <span className="shrink-0 text-muted-foreground/60">
            {showDetail ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </span>
        )}
      </button>

      {/* 可展开详情：image_generate → 图片结果（占位→图）；run 类别 → 终端输出；其余 → 换行文本 */}
      {showDetail && call.detail && (
        <div className="ml-8 mb-1 mt-0.5">
          {call.name === "image_generate" ? (
            <GeneratedImage result={call.detail} />
          ) : call.category === "run" ? (
            <TerminalOutput text={call.detail} maxHeightClass="max-h-56" />
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/30 p-2.5 text-body-sm leading-relaxed text-muted-foreground">
              {call.detail}
            </pre>
          )}
        </div>
      )}

      {/* 审批条 */}
      {call.needsApproval && !call.approved && <ApprovalBar call={call} />}

      {/* 变更文件 chips（参考 zosma 产物预览：可点击在资源管理器打开） */}
      {call.filesChanged && call.filesChanged.length > 0 && (
        <div className="ml-8 mb-0.5 mt-0.5 flex flex-wrap items-center gap-1">
          {call.filesChanged.map((f) => (
            <button
              key={f}
              onClick={() => {
                const base = config.workspace ? config.workspace.replace(/[\\/]$/, "") : "";
                void invoke("reveal_path", { path: base ? `${base}\\${f}` : f }).catch(() => {});
              }}
              title={`在资源管理器中显示 ${f}`}
              className="flex items-center gap-1 rounded border border-border bg-white px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            >
              <FileEdit className="h-3 w-3" strokeWidth={2} />
              <span className="max-w-[160px] truncate">{f}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
