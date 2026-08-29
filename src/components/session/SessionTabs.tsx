/**
 * SessionTabs - 会话多标签条（S3-4：打开/关闭/切换/拖拽排序）
 *
 *   - 标签 = sessions store 中同时打开的一组会话（$openTabIds）；
 *   - 点击标签 → setActiveSession（主对话区跟随，侧栏高亮同步）；
 *   - × 关闭：若关的是活跃标签则激活右侧邻居；全部关闭后显示空态；
 *   - 拖拽排序：原生 HTML5 DnD，dragover 按鼠标位置即时重排；
 *   - 侧栏 / ⌘J 切换会话时自动补开对应标签（$tabsDismissed 阻止
 *     用户刚关掉的最后一个标签被立刻复活）。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { HeaderRule } from "@/components/layout/HeaderRule";
import { $sessions, createSession } from "@/store/sessions";
import { $activeSessionId, setActiveSession } from "@/store/session";
import { $openTabIds, $tabsDismissed, $suppressTabOnce, openTab, closeTab, reorderTabs } from "@/store/open-tabs";

export function SessionTabs() {
  const tabIds = useStore($openTabIds);
  const activeId = useStore($activeSessionId);
  const sessions = useStore($sessions);
  const [dragId, setDragId] = useState<string | null>(null);

  // 活跃会话在会话列表中 → 自动补开标签（用户手动关闭最后一个时不复活；
  // 左栏普通点击的 in-place 切换经 $suppressTabOnce 跳过，不开标签）
  useEffect(() => {
    if ($suppressTabOnce.get()) {
      $suppressTabOnce.set(false);
      return;
    }
    if ($tabsDismissed.get()) return;
    if (tabIds.includes(activeId)) return;
    if (sessions.some((s) => s.id === activeId)) openTab(activeId);
  }, [activeId, tabIds, sessions]);

  const titleOf = (id: string) => sessions.find((s) => s.id === id)?.title ?? "新会话";

  const handleClose = (id: string) => {
    const neighbor = closeTab(id);
    if (id === activeId && neighbor) setActiveSession(neighbor);
  };

  const handleNew = () => {
    const s = createSession();
    openTab(s.id);
    setActiveSession(s.id);
  };

  // 拖拽重排：dragover 按目标标签的左右半区插入，即时重排
  const onTabDragOver = (e: React.DragEvent, targetId: string) => {
    if (!dragId || dragId === targetId) return;
    e.preventDefault();
    const ids = $openTabIds.get();
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientX < rect.left + rect.width / 2;
    reorderTabs(dragId, before ? to : to + 1);
  };

  return (
    // 标签条：底部描边与顶栏同款（HeaderRule：两端各留 15px 空隙），分隔主对话区
    <div className="relative shrink-0 px-3 py-2">
      <HeaderRule />
      <div className="flex items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {tabIds.length === 0 ? (
          /* 空态：提示 + 新会话入口 */
          <div className="flex w-full items-center justify-between rounded-md border border-dashed border-border px-3 py-1.5">
            <span className="text-[11px] text-muted-foreground">
              无打开的会话标签 — 从左侧栏选择会话，或新建一个
            </span>
            <button
              onClick={handleNew}
              className="flex items-center gap-1 rounded-md bg-[#303030] px-2 py-0.5 text-[11px] font-medium text-white transition-colors hover:bg-[#464646]"
            >
              <Plus className="h-3 w-3" />
              新会话
            </button>
          </div>
        ) : (
          <>
            {tabIds.map((id) => {
              const active = id === activeId;
              return (
                <span
                  key={id}
                  draggable
                  onDragStart={() => setDragId(id)}
                  onDragEnd={() => setDragId(null)}
                  onDragOver={(e) => onTabDragOver(e, id)}
                  onDrop={(e) => e.preventDefault()}
                  className={cn(
                    "group flex min-w-0 max-w-[150px] cursor-pointer select-none items-center gap-1 rounded-md px-2 py-1 text-body-sm transition-colors",
                    active
                      ? // 激活标签：底色与悬停一致（灰白 bg-muted）+ 粗体字
                        "bg-muted font-medium text-[#303030]"
                      : "text-muted-foreground hover:bg-muted hover:text-[#303030]",
                    dragId === id && "opacity-50",
                  )}
                >
                  <button
                    onClick={() => setActiveSession(id)}
                    title={`切换会话：${titleOf(id)}`}
                    className="flex min-w-0 items-center gap-1.5"
                  >
                    <span className="truncate">{titleOf(id)}</span>
                  </button>
                  <button
                    onClick={() => handleClose(id)}
                    title="关闭标签"
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground/60 transition-colors hover:bg-border hover:text-[#303030]"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
            <button
              onClick={handleNew}
              title="新会话标签"
              className="ml-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
