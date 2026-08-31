/**
 * FileChangesRow — 回合文件更改汇总（产品清单 #4）
 *
 * 聚合本轮 edit/write 类工具调用：按文件去重统计改动行数，折叠态显示
 * "已更改 N 个文件（+X/-Y）"，展开列出所有文件（图标/文件名/路径/增删行数）。
 * 点击文件 → onOpenFile 回调（MainPanel 接到文件查看器；未接时复制路径）。
 * 数据源：$toolCalls（filesChanged/args.file_path，与 tool-summary 同源）。
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import type { ToolCall } from "@/store/tool-calls";
import { ChevronDown, ChevronRight, FileCode, Copy, Check } from "lucide-react";

interface FileChange {
  path: string;
  name: string;
  dir: string;
  ext: string;
  added: number;
  removed: number;
  ops: number;
}

const EXT_COLOR: Record<string, string> = {
  ts: "text-[#3178C6]",
  tsx: "text-[#3178C6]",
  js: "text-[#F7DF1E]",
  jsx: "text-[#F7DF1E]",
  rs: "text-[#DEA584]",
  py: "text-[#3572A5]",
  css: "text-[#A074C4]",
  html: "text-[#E34C26]",
  json: "text-[#CBCB41]",
  md: "text-muted-foreground",
};

/** 从一条工具调用提取文件路径与增删行数（写/改类工具）。 */
function extractChange(call: ToolCall): FileChange | null {
  if (call.category !== "edit" && call.name !== "write" && call.name !== "edit") return null;
  const args = (call.args ?? {}) as Record<string, unknown>;
  const path = [args.file_path, args.path, args.target_file, ...(Array.isArray(call.filesChanged) ? call.filesChanged : [])]
    .find((v): v is string => typeof v === "string" && v.length > 0);
  if (path === undefined) return null;
  const added = typeof args.new_string === "string" ? Math.max(1, args.new_string.split("\n").length) : 0;
  const removed = typeof args.old_string === "string" ? Math.max(1, args.old_string.split("\n").length) : 0;
  const isWrite = call.name === "write" || (typeof args.content === "string" && args.old_string === undefined);
  const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
  const dir = path.replace(/\\/g, "/").split("/").slice(0, -1).join("/");
  return {
    path,
    name,
    dir,
    ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
    added: isWrite ? added : added,
    removed: isWrite ? 0 : removed,
    ops: 1,
  };
}

/** 聚合工具调用 → 文件更改列表（按路径去重合并操作次数与增删行数）。 */
export function aggregateFileChanges(toolCalls: ToolCall[]): { files: FileChange[]; added: number; removed: number } {
  const byPath = new Map<string, FileChange>();
  for (const call of toolCalls) {
    const change = extractChange(call);
    if (change === null) continue;
    const prev = byPath.get(change.path);
    if (prev === undefined) {
      byPath.set(change.path, change);
    } else {
      prev.added += change.added;
      prev.removed += change.removed;
      prev.ops += 1;
    }
  }
  const files = [...byPath.values()];
  return {
    files,
    added: files.reduce((a, f) => a + f.added, 0),
    removed: files.reduce((a, f) => a + f.removed, 0),
  };
}

export function FileChangesRow({
  toolCalls,
  onOpenFile,
  onReview,
  className,
}: {
  toolCalls: ToolCall[];
  onOpenFile?: (path: string) => void;
  /** 点击"审查"打开 Git Review（diff 审查面板） */
  onReview?: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const { files, added, removed } = useMemo(() => aggregateFileChanges(toolCalls), [toolCalls]);

  if (files.length === 0) return null;

  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path).then(() => {
      setCopied(path);
      window.setTimeout(() => setCopied(null), 1500);
    });
  };

  return (
    <div className={cn("rounded-lg border border-black/5 bg-white/60 text-xs", className)}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        {open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        )}
        <FileCode className="h-3.5 w-3.5 shrink-0 text-[#6366F1]" />
        <span className="text-[#303030]">
          已更改 <span className="font-semibold tabular-nums">{files.length}</span> 个文件
        </span>
        <span className="tabular-nums text-[#10B981]">+{added}</span>
        <span className="tabular-nums text-[#EF4444]">-{removed}</span>
        {onReview && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.stopPropagation();
                onReview();
              }
            }}
            title="打开 Git Review 审查改动"
            className="ml-auto shrink-0 rounded border border-black/10 px-1.5 py-px text-[10px] text-[#464646] transition-colors hover:border-[#6366F1] hover:text-[#6366F1]"
          >
            审查
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-black/5">
          {files.map((f) => (
            <div
              key={f.path}
              onClick={() => onOpenFile?.(f.path)}
              title={onOpenFile ? "点击在文件查看器中打开" : f.path}
              className="group flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-muted/40"
            >
              <span className={cn("shrink-0 text-[10px] font-bold uppercase", EXT_COLOR[f.ext] ?? "text-muted-foreground")}>
                {f.ext || "file"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#303030]">{f.name}</p>
                <p className="truncate text-[10px] text-muted-foreground" title={f.path}>{f.dir}</p>
              </div>
              {f.added > 0 && <span className="shrink-0 text-[10px] tabular-nums text-[#10B981]">+{f.added}</span>}
              {f.removed > 0 && <span className="shrink-0 text-[10px] tabular-nums text-[#EF4444]">-{f.removed}</span>}
              <button
                onClick={() => copyPath(f.path)}
                title="复制路径"
                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
              >
                {copied === f.path ? <Check className="h-3 w-3 text-[#10B981]" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
