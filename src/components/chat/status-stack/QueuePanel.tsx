/**
 * QueuePanel - 对话排队面板
 *
 * Agent 忙时用户入队的消息列表。
 * 每条可编辑 / 立即发送 / 删除。
 * 停车时强制展开并显示"恢复"按钮。
 */

import { useState, useRef, type ReactNode } from "react";
import { useStore } from "@nanostores/react";
import { Layers3, Pencil, CornerDownLeft, Trash2, PlayCircle } from "lucide-react";
import { $queueState, removeQueued, updateQueuedText, promoteQueued, resumeQueuedPrompts } from "@/store/queue";
import { clearAgentBusy } from "@/store/agent";
import { StatusSection } from "./StatusSection";
import { StatusRow } from "./StatusRow";

// ----------------------------------------------------------------
// 工具
// ----------------------------------------------------------------

function formatTimeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds}s前`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;
  return `${Math.floor(minutes / 60)}小时前`;
}

/** 小型操作按钮（trailing slot 内） */
function RowAction({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------
// 单条排队消息
// ----------------------------------------------------------------

function QueueRow({ item }: { item: { id: string; text: string; displayText?: string; queuedAt: number } }) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    const val = inputRef.current?.value.trim();
    if (val) updateQueuedText(item.id, val);
    setEditing(false);
  };

  const handleSendNow = () => {
    promoteQueued(item.id);
    clearAgentBusy(); // 中断当前 turn（清空忙碌桶），auto-drain 会接管
  };

  // 编辑态：行内输入框
  if (editing) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2 py-1">
        <span
          className="flex shrink-0 items-center justify-center text-blue-500"
          style={{ width: 16, height: 16 }}
        >
          <Pencil className="h-3 w-3" />
        </span>
        <input
          ref={inputRef}
          defaultValue={item.text}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleSave();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={handleSave}
          className="min-w-0 flex-1 rounded border border-blue-300 bg-white px-1.5 py-0.5 text-[13px] text-[#303030] focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>
    );
  }

  // 正常态
  return (
    <StatusRow
      state="pending"
      title={item.displayText ?? item.text}
      subtitle={formatTimeAgo(item.queuedAt)}
      trailing={
        <>
          <RowAction title="编辑" onClick={() => setEditing(true)}>
            <Pencil className="h-3 w-3" />
          </RowAction>
          <RowAction title="立即发送" onClick={handleSendNow}>
            <CornerDownLeft className="h-3 w-3" />
          </RowAction>
          <RowAction title="删除" onClick={() => removeQueued(item.id)}>
            <Trash2 className="h-3 w-3" />
          </RowAction>
        </>
      }
    />
  );
}

// ----------------------------------------------------------------
// QueuePanel
// ----------------------------------------------------------------

export function QueuePanel() {
  const { items, parked } = useStore($queueState);

  if (items.length === 0) return null;

  return (
    <StatusSection
      label={parked ? "排队已暂停" : "排队"}
      icon={<Layers3 className="h-3.5 w-3.5 text-muted-foreground" />}
      accessory={parked ? `queuedPaused(${items.length})` : `queued(${items.length})`}
      forceOpen={parked}
    >
      {parked && (
        <button
          onClick={() => resumeQueuedPrompts()}
          className="mb-0.5 flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-blue-600 transition-colors hover:bg-blue-50"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          恢复排空
        </button>
      )}
      {items.map((item) => (
        <QueueRow key={item.id} item={item} />
      ))}
    </StatusSection>
  );
}
