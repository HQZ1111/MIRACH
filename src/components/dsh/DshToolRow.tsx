/**
 * dsh ToolRow 移植（ui-tool/src/client/tool/components/ToolRow.tsx 的通用形态）：
 * 单行工具摘要 —— [16 状态点/图标] + 标题 + 分隔点 + 摘要；展开显示
 * IN/OUT 卡（输入参数 / 输出结果）。运行中带 sweep 光泽；错误行摘要用错误色。
 * 交互实现用显式 <button> 承载整行点击（合成层里 div+onClick 偶发不响应，button 必响应）。
 */
import { useState } from "react";
import { ChevronDown, FilePen, GitBranch, Search, TerminalSquare, Wrench } from "lucide-react";
import type { DshToolCallInfo } from "@/store/chat";
import css from "./dsh-tool-row.module.css";

/** 工具名 → 图标（dsh 用工具注册表图标；此处按类别映射 lucide 图标） */
function toolIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes("edit") || n.includes("write") || n.includes("patch")) return <FilePen size={14} />;
  if (n.includes("explore") || n.includes("search") || n.includes("read") || n.includes("grep") || n.includes("find")) return <Search size={14} />;
  if (n.includes("run") || n.includes("exec") || n.includes("bash") || n.includes("code") || n.includes("terminal")) return <TerminalSquare size={14} />;
  if (n.includes("delegate") || n.includes("subagent") || n.includes("task")) return <GitBranch size={14} />;
  return <Wrench size={14} />;
}

function humanize(name: string): string {
  return name.replace(/[_/]+/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function argsText(args: Record<string, unknown>): string | null {
  if (!args || Object.keys(args).length === 0) return null;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
}

export function DshToolRow({ call }: { call: DshToolCallInfo }) {
  const [expanded, setExpanded] = useState(false);
  const running = call.status === "running";
  const error = call.status === "error";
  const body = argsText(call.args);
  const output = call.result ?? call.partialOutput;
  const hasBody = body !== null;
  const hasOut = output !== undefined && output !== "";
  const expandable = hasBody || hasOut;

  // 折叠摘要：错误行显示错误首行（错误色）；运行中显示"正在执行…"；否则显示参数摘要
  let summary: string;
  if (error) {
    summary = (call.result ?? call.partialOutput ?? "").split("\n")[0] || "执行失败";
  } else if (running) {
    summary = "正在执行…";
  } else {
    summary = body ?? "已执行";
  }

  return (
    <div className={css.root} data-state={call.status}>
      <button
        type="button"
        className={css.row}
        aria-expanded={expandable ? expanded : undefined}
        onClick={() => {
          if (expandable) setExpanded((v) => !v);
        }}
        style={{ cursor: expandable ? "pointer" : "default", textAlign: "left", width: "100%" }}
      >
        <span className={css.leading}>{toolIcon(call.name)}</span>
        <span className={css.title}>{humanize(call.name)}</span>
        {summary !== "" && (
          <>
            <span className={css.sep} aria-hidden />
            <span className={`${css.summary} ${error ? css.errorSummary ?? "" : ""}`}>{summary}</span>
          </>
        )}
        {expandable && (
          <ChevronDown
            size={14}
            className={css.chevron}
            style={{ transform: expanded ? "rotate(180deg)" : undefined, transition: "transform .15s", marginLeft: "auto", flexShrink: 0 }}
          />
        )}
      </button>
      {expanded && (hasBody || hasOut) && (
        <div className={css.bodyWrap}>
          <div className={css.ioCard}>
            {hasBody && (
              <div className={css.ioSection}>
                <span className={css.ioLabel}>IN</span>
                <span className={css.ioText}>{body}</span>
              </div>
            )}
            {hasBody && hasOut && <span className={css.ioDivider} aria-hidden />}
            {hasOut && (
              <div className={css.ioSection}>
                <span className={css.ioLabel}>OUT</span>
                <span className={css.ioText} data-error={error || undefined}>
                  {output}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
