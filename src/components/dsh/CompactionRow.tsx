/**
 * dsh CompactionItem 移植（ui-conversation/src/client/chat/CompactionItem.tsx）：
 * 上下文压缩标记行 —— 默认折叠：[上下文图标 + chevron] + 「Compaction」 + 摘要；
 * 有摘要时可展开显示压缩后给模型的 summary。
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Layers } from "lucide-react";
import type { CompactionInfo } from "@/store/chat";
import css from "./compaction-row.module.css";

export function CompactionRow({ info }: { info: CompactionInfo }) {
  const [expanded, setExpanded] = useState(false);
  const expandable = info.summary !== undefined && info.summary !== null && info.summary !== "";
  const open = expandable && expanded;
  const summary =
    info.count !== undefined && info.tokens !== undefined
      ? `已压缩 ${info.count} 条 · ~${info.tokens} tokens`
      : "上下文已压缩";

  return (
    <div className={css.compactionRow}>
      <button
        type="button"
        className={css.compactionButton}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className={css.compactionLeading} aria-hidden>
          <span className={css.compactionContextIcon}>
            <Layers size={14} />
          </span>
          <span className={css.compactionDisclosureIcon} data-compaction-disclosure={open ? "expanded" : "collapsed"}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </span>
        <span className={css.compactionTitle}>Compaction</span>
        <span className={css.compactionSep} aria-hidden />
        <span className={css.compactionSummary}>{summary}</span>
      </button>
      {open && info.summary && (
        <div className={css.compactionBody}>{info.summary}</div>
      )}
    </div>
  );
}
