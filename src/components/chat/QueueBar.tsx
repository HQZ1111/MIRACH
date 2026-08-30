/**
 * QueueBar - 输入框上方的排队消息条
 *
 * busy 时入队的消息直接显示在输入框上方（消息内容 + 编辑/立即发送/取消排队），
 * 与活动窗口里的排队面板共用同一个 store。
 * 停车时显示"恢复排空"按钮。
 */

import { useState } from "react";
import { useStore } from "@nanostores/react";
import { Layers3, Pencil, CornerDownLeft, Trash2, PlayCircle, Check } from "lucide-react";
import {
  $queueState,
  removeQueued,
  updateQueuedText,
  promoteQueued,
  resumeQueuedPrompts,
} from "@/store/queue";
import { clearAgentBusy } from "@/store/agent";

/** 单条排队消息：内容 + 操作（编辑 / 立即发送 / 取消排队） */
function QueuedChip({ item }: { item: { id: string; text: string; displayText?: string } }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.text);

  const save = () => {
    const v = val.trim();
    if (v) updateQueuedText(item.id, v);
    setEditing(false);
  };

  // 编辑态：行内输入框 + 保存
  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-lg border border-blue-300 bg-blue-50/70 px-2 py-1">
        <input
          autoFocus
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") {
              setVal(item.text);
              setEditing(false);
            }
          }}
          onBlur={save}
          placeholder="编辑排队消息…"
          className="min-w-0 flex-1 bg-transparent text-body-sm text-[#303030] focus:outline-none"
          style={{ maxWidth: 200 }}
        />
        <button
          onClick={save}
          title="保存"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-green-600 transition-colors hover:bg-black/5"
        >
          <Check className="h-3 w-3" strokeWidth={2.5} />
        </button>
      </div>
    );
  }

  return (
    <div className="group flex max-w-[320px] items-center gap-1 rounded-lg border border-black/10 bg-black/[0.03] px-2 py-1">
      <Layers3 className="h-3 w-3 shrink-0 text-[#6366F1]" strokeWidth={2.5} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[#303030]">
        {item.displayText ?? item.text}
      </span>
      <button
        onClick={() => {
          setVal(item.text);
          setEditing(true);
        }}
        title="编辑"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
      >
        <Pencil className="h-3 w-3" />
      </button>
      <button
        onClick={() => {
          promoteQueued(item.id);
          clearAgentBusy(); // 中断当前 turn（清空忙碌桶），auto-drain 立即接管发送
        }}
        title="立即发送"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
      >
        <CornerDownLeft className="h-3 w-3" />
      </button>
      <button
        onClick={() => removeQueued(item.id)}
        title="取消排队"
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  );
}

/** 排队消息条：有排队消息时显示在输入框上方 */
export function QueueBar() {
  const { items, parked } = useStore($queueState);

  if (items.length === 0) return null;

  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      {/* 停车状态：暂停自动排空，显示恢复按钮 */}
      {parked && (
        <button
          onClick={() => resumeQueuedPrompts()}
          className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-[12px] font-medium text-blue-600 transition-colors hover:bg-blue-100"
        >
          <PlayCircle className="h-3 w-3" />
          恢复排空
        </button>
      )}
      {items.map((item) => (
        <QueuedChip key={item.id} item={item} />
      ))}
    </div>
  );
}
