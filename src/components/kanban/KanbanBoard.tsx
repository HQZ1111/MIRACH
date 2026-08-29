/**
 * KanbanBoard — 看板页面（参考 astryx kanban-board 模板，Tailwind 移植 + 功能完善）
 *
 * 四列（待办 / 进行中 / 审查中 / 已完成）+ 卡片（编号/优先级徽章 + 标题/描述
 * + 编辑时间/截止日期 + 更多操作）+ 指针拖拽排序（阈值 5px、浮动卡片跟随、
 * ghost 占位、按列内插入索引落位）+ 工具栏（冲刺切换 / 搜索 / 筛选 / 排序 / 添加任务）。
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@/lib/utils";
import { useStore } from "@nanostores/react";
import { $todosState } from "@/store/todos";
import { MOCK } from "@/lib/mock";
import {
  CheckCircle2,
  ClipboardCheck,
  Funnel,
  Info,
  Inbox,
  ListFilter,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";

// ============= 类型与数据 =============

type ColumnId = "todo" | "in-progress" | "in-review" | "done";
type Priority = "high" | "medium" | "low";

interface WorkItem {
  id: string;
  column: ColumnId;
  ref: string;
  priority: Priority;
  title: string;
  description: string;
  lastEdited: string;
  dueDate: string;
}

interface ColumnMeta {
  id: ColumnId;
  title: string;
  dot: string;
  tooltip: string;
  emptyTitle: string;
  emptyDescription: string;
  emptyIcon: typeof Inbox;
}

interface DropTarget {
  column: ColumnId;
  index: number;
}

interface DragState {
  id: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  pointerX: number;
  pointerY: number;
  target: DropTarget | null;
}

const COLUMNS: ColumnMeta[] = [
  { id: "todo", title: "待办", dot: "#9CA3AF", tooltip: "本轮待处理", emptyTitle: "待办为空", emptyDescription: "拉入本轮的条目会出现在这里", emptyIcon: Inbox },
  { id: "in-progress", title: "进行中", dot: "#017CF3", tooltip: "正在处理中", emptyTitle: "没有进行中的条目", emptyDescription: "正在处理的条目会出现在这里", emptyIcon: RefreshCw },
  { id: "in-review", title: "审查中", dot: "#F59E0B", tooltip: "等待审查", emptyTitle: "没有待审查条目", emptyDescription: "等待审查的条目会出现在这里", emptyIcon: ClipboardCheck },
  { id: "done", title: "已完成", dot: "#10B981", tooltip: "已完成", emptyTitle: "还没有完成", emptyDescription: "完成的条目会出现在这里", emptyIcon: CheckCircle2 },
];

const PRIORITY_META: Record<Priority, { label: string; cls: string }> = {
  high: { label: "高", cls: "bg-red-50 text-[#EF4444] border-red-200 dark:bg-red-500/15 dark:border-red-500/30" },
  medium: { label: "中", cls: "bg-amber-50 text-[#F59E0B] border-amber-200 dark:bg-amber-500/15 dark:border-amber-500/30" },
  low: { label: "低", cls: "bg-teal-50 text-[#0D9488] border-teal-200 dark:bg-teal-500/15 dark:border-teal-500/30" },
};

/** 优先级筛选选项（含"全部"） */
const PRIORITY_FILTERS: (Priority | null)[] = [null, "high", "medium", "low"];
const PRIORITY_FILTER_LABEL: Record<string, string> = { high: "高", medium: "中", low: "低" };

const INITIAL_ITEMS: WorkItem[] = [
  { id: "t1", column: "todo", ref: "任务 4821", priority: "low", title: "起草项目启动简报", description: "写一份简报，概述项目的目标、范围和成功标准。", lastEdited: "2 小时前", dueDate: "7月8日" },
  { id: "t2", column: "todo", ref: "任务 4842", priority: "low", title: "收集干系人反馈", description: "收集关键干系人的意见，总结主要主题供下次评审。", lastEdited: "1 天前", dueDate: "7月11日" },
  { id: "p1", column: "in-progress", ref: "任务 4825", priority: "high", title: "设计落地页布局", description: "为落地页制作初版布局，并分享以获取早期反馈。", lastEdited: "18 分钟前", dueDate: "7月3日" },
  { id: "p2", column: "in-progress", ref: "任务 4833", priority: "medium", title: "搭建项目工作区", description: "配置共享工作区并邀请团队，确保所有人可访问。", lastEdited: "5 分钟前", dueDate: "7月4日" },
  { id: "r1", column: "done", ref: "任务 4788", priority: "low", title: "撰写每周状态更新", description: "用简短更新总结进展、阻碍和下一步计划。", lastEdited: "昨天", dueDate: "7月1日" },
  { id: "r2", column: "done", ref: "任务 4789", priority: "high", title: "准备演示走查", description: "制作一段简短走查，覆盖演示的主要功能。", lastEdited: "3 天前", dueDate: "6月30日" },
  { id: "r3", column: "done", ref: "任务 4790", priority: "medium", title: "审查并合并待处理变更", description: "检查待处理变更，留下评论，合并就绪的部分。", lastEdited: "4 天前", dueDate: "6月28日" },
];

const DRAG_THRESHOLD = 5;
const COLUMN_WIDTH = 300;

// ============= 卡片 =============

function BoardCardBody({
  item,
  onMove,
}: {
  item: WorkItem;
  onMove: (id: string, to: ColumnId) => void;
}) {
  const priority = PRIORITY_META[item.priority];
  const [menuOpen, setMenuOpen] = useState(false);
  const moveTargets = COLUMNS.filter((c) => c.id !== item.column).map((c) => ({
    label: `移动到「${c.title}」`,
    run: () => onMove(item.id, c.id),
  }));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <span className="rounded border border-black/10 bg-muted/40 px-1.5 py-px text-[10px] font-medium text-muted-foreground">
            {item.ref}
          </span>
          <span className={cn("rounded border px-1.5 py-px text-[10px] font-medium", priority.cls)}>
            {priority.label}
          </span>
        </div>
        {/* 更多操作（点击卡片时避免触发拖拽：pointerdown 上忽略按钮） */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
            aria-label="条目操作"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-lg border border-black/10 bg-white py-1 shadow-md">
                <button
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#303030] hover:bg-muted"
                >
                  打开
                </button>
                <button
                  onClick={() => setMenuOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#303030] hover:bg-muted"
                >
                  分配给我
                </button>
                <div className="my-1 h-px bg-border" />
                {moveTargets.map((m) => (
                  <button
                    key={m.label}
                    onClick={() => {
                      m.run();
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-[#303030] hover:bg-muted"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-[13px] font-semibold leading-snug text-[#303030]">{item.title}</p>
        <p className="line-clamp-2 text-xs leading-snug text-muted-foreground">{item.description}</p>
      </div>

      <p className="text-[11px] text-muted-foreground">
        编辑于 {item.lastEdited} · 截止 {item.dueDate}
      </p>
    </div>
  );
}

// ============= 列 =============

function BoardColumn({
  meta,
  count,
  contentRef,
  children,
}: {
  meta: ColumnMeta;
  count: number;
  contentRef: (el: HTMLDivElement | null) => void;
  children: React.ReactNode;
}) {
  const Icon = meta.emptyIcon;
  return (
    <div
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-xl border border-black/5 bg-border dark:bg-[#151515]"
      style={{ flexBasis: COLUMN_WIDTH }}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-black/5 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.dot }} />
          <p className="text-[13px] font-semibold text-[#303030]">{meta.title}</p>
          <span title={meta.tooltip} className="flex">
            <Info className="h-3.5 w-3.5 text-muted-foreground/60" />
          </span>
        </div>
        <span className="text-[11px] tabular-nums text-muted-foreground">{count}</span>
      </div>
      <div ref={contentRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {children ?? (
          <div className="flex flex-col items-center gap-1.5 py-10 text-center">
            <Icon className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs font-medium text-muted-foreground">{meta.emptyTitle}</p>
            <p className="text-[11px] text-muted-foreground/70">{meta.emptyDescription}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ============= 主组件 =============

export function KanbanBoard() {
  const [items, setItems] = useState<WorkItem[]>(INITIAL_ITEMS);
  const [sprint, setSprint] = useState("003");
  const [drag, setDrag] = useState<DragState | null>(null);
  // 真实数据接入：dsh todo 工具的任务实时映射到看板列
  // （pending→待办 / in_progress→进行中 / completed→已完成），覆盖演示数据
  const todosState = useStore($todosState);
  useEffect(() => {
    if (MOCK) return;
    const mapped: WorkItem[] = todosState.items
      .filter((t) => t.status !== "cancelled")
      .map((t, i) => ({
        id: t.id,
        column: (t.status === "in_progress" ? "in-progress" : t.status === "completed" ? "done" : "todo") as ColumnId,
        ref: `TODO-${String(i + 1).padStart(2, "0")}`,
        priority: "medium" as Priority,
        title: t.content,
        description: "dsh todo 工具 · 本轮任务",
        lastEdited: "刚刚",
        dueDate: "",
      }));
    setItems(mapped);
  }, [todosState.items]);
  // 工具栏：搜索 / 筛选 / 排序 / 添加任务
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [filterPriority, setFilterPriority] = useState<Priority | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [sortMode, setSortMode] = useState<"due" | "title" | null>(null);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newDue, setNewDue] = useState("");

  const columnEls = useRef(new Map<ColumnId, HTMLElement>());
  const cardEls = useRef(new Map<string, HTMLElement>());
  const columnRefCbs = useRef(new Map<ColumnId, (el: HTMLDivElement | null) => void>());
  const cardRefCbs = useRef(new Map<string, (el: HTMLDivElement | null) => void>());
  const teardownRef = useRef<(() => void) | null>(null);

  const getColumnRef = (id: ColumnId) => {
    let cb = columnRefCbs.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) columnEls.current.set(id, el);
        else columnEls.current.delete(id);
      };
      columnRefCbs.current.set(id, cb);
    }
    return cb;
  };
  const getCardRef = (id: string) => {
    let cb = cardRefCbs.current.get(id);
    if (!cb) {
      cb = (el) => {
        if (el) cardEls.current.set(id, el);
        else cardEls.current.delete(id);
      };
      cardRefCbs.current.set(id, cb);
    }
    return cb;
  };

  // 过滤后的条目（搜索 + 优先级筛选 + 排序）
  const visibleItems = useMemo(() => {
    let list = items;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (it) => it.title.toLowerCase().includes(q) || it.description.toLowerCase().includes(q),
      );
    }
    if (filterPriority) list = list.filter((it) => it.priority === filterPriority);
    if (sortMode === "due") list = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate, "zh-CN"));
    if (sortMode === "title") list = [...list].sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    return list;
  }, [items, query, filterPriority, sortMode]);

  const itemsByColumn = useMemo(() => {
    const map: Record<ColumnId, WorkItem[]> = { todo: [], "in-progress": [], "in-review": [], done: [] };
    for (const item of visibleItems) map[item.column].push(item);
    return map;
  }, [visibleItems]);

  const moveItem = (id: string, to: ColumnId) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, column: to } : it)));
  };

  /** 添加任务：新卡片进入「待办」列 */
  const addItem = () => {
    const title = newTitle.trim();
    if (!title) return;
    setItems((prev) => [
      ...prev,
      {
        id: `n${Date.now()}`,
        column: "todo",
        ref: `任务 ${Math.floor(2000 + Math.random() * 9000)}`,
        priority: newPriority,
        title,
        description: "（新建条目）",
        lastEdited: "刚刚",
        dueDate: newDue || "未设置",
      },
    ]);
    setNewTitle("");
    setNewPriority("medium");
    setNewDue("");
    setAdding(false);
  };

  // 指针位置 → 列 + 插入索引（忽略被拖卡片，对剩余卡片计算）
  const computeTarget = (px: number, py: number, draggedId: string): DropTarget | null => {
    for (const [colId, el] of Array.from(columnEls.current.entries())) {
      const r = el.getBoundingClientRect();
      if (px < r.left || px > r.right || py < r.top || py > r.bottom) continue;
      const ids = itemsByColumn[colId].filter((it) => it.id !== draggedId).map((it) => it.id);
      let index = ids.length;
      for (let i = 0; i < ids.length; i++) {
        const cardEl = cardEls.current.get(ids[i]);
        if (!cardEl) continue;
        const cr = cardEl.getBoundingClientRect();
        if (py < cr.top + cr.height / 2) {
          index = i;
          break;
        }
      }
      return { column: colId, index };
    }
    return null;
  };

  const commitDrag = (id: string, target: DropTarget) => {
    setItems((prev) => {
      const moved = prev.find((it) => it.id === id);
      if (!moved) return prev;
      const rest = prev.filter((it) => it.id !== id);
      const updated: WorkItem = { ...moved, column: target.column };
      const colItems = rest.filter((it) => it.column === target.column);
      const anchor = colItems[target.index];
      if (!anchor) return [...rest, updated];
      const at = rest.indexOf(anchor);
      return [...rest.slice(0, at), updated, ...rest.slice(at)];
    });
  };

  const onCardPointerDown = (e: ReactPointerEvent, id: string) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, [role='menuitem'], [role='menu']")) return;
    const el = cardEls.current.get(id);
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;
    const { width, height } = rect;

    let started = false;
    let target: DropTarget | null = null;

    const onMove = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < DRAG_THRESHOLD) return;
      started = true;
      target = computeTarget(ev.clientX, ev.clientY, id);
      setDrag({ id, width, height, offsetX, offsetY, pointerX: ev.clientX, pointerY: ev.clientY, target });
    };
    const onUp = () => {
      teardownRef.current?.();
      if (started && target) commitDrag(id, target);
      setDrag(null);
    };
    const teardown = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      teardownRef.current = null;
    };
    teardownRef.current = teardown;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const draggedItem = drag ? items.find((it) => it.id === drag.id) : undefined;
  const isDragging = drag !== null;

  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isDragging]);
  useEffect(() => () => teardownRef.current?.(), []);

  const renderColumnCards = (colId: ColumnId): React.ReactNode => {
    const colItems = itemsByColumn[colId];
    const visible = drag ? colItems.filter((it) => it.id !== drag.id) : colItems;
    const ghostTarget = drag && drag.target && drag.target.column === colId ? drag : null;
    if (visible.length === 0 && !ghostTarget) return null;

    const nodes: React.ReactNode[] = visible.map((it) => (
      <div
        key={it.id}
        ref={getCardRef(it.id)}
        onPointerDown={(e) => onCardPointerDown(e, it.id)}
        className="cursor-grab touch-none select-none rounded-lg border border-black/10 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
      >
        <BoardCardBody item={it} onMove={moveItem} />
      </div>
    ));

    if (ghostTarget && ghostTarget.target) {
      const index = Math.min(ghostTarget.target.index, nodes.length);
      nodes.splice(
        index,
        0,
        <div key="drag-ghost" className="rounded-lg bg-muted" style={{ height: ghostTarget.height }} />,
      );
    }
    return <div className="space-y-2">{nodes}</div>;
  };

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-black/5 px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-base font-bold text-[#303030]">冲刺看板</p>
          <span className="rounded-full bg-muted px-2 py-px text-[11px] font-medium text-muted-foreground">
            {items.length} 条
          </span>
          {sortMode && (
            <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">
              {sortMode === "due" ? "按截止日期排序" : "按标题排序"}
            </span>
          )}
          {filterPriority && (
            <span className="rounded-full bg-muted px-2 py-px text-[11px] text-muted-foreground">
              仅看优先级：{PRIORITY_FILTER_LABEL[filterPriority]}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 冲刺选择（演示：切换当前冲刺标签） */}
          <select
            value={sprint}
            onChange={(e) => setSprint(e.target.value)}
            title="切换当前冲刺（演示数据为同一批）"
            className="rounded-md border border-border bg-white px-2 py-1 text-xs text-[#303030] outline-none focus:border-[#303030]/30"
            aria-label="冲刺选择"
          >
            {["003", "002", "001"].map((s) => (
              <option key={s} value={s}>
                冲刺 {s}
              </option>
            ))}
          </select>
          <div className="h-5 w-px bg-border" />

          {/* 搜索（展开输入框，按标题/描述过滤） */}
          {searchOpen && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题或描述…"
                className="w-44 rounded-md border border-border bg-white py-1 pl-7 pr-7 text-xs text-[#303030] outline-none focus:border-[#303030]/30"
              />
              <button
                onClick={() => {
                  setSearchOpen(false);
                  setQuery("");
                }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-[#303030]"
                aria-label="关闭搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button
            title={searchOpen ? "关闭搜索" : "搜索"}
            onClick={() => setSearchOpen((v) => !v)}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              searchOpen ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
            )}
            aria-label="搜索"
          >
            <Search className="h-4 w-4" />
          </button>

          {/* 筛选（按优先级） */}
          <div className="relative">
            <button
              title="按优先级筛选"
              onClick={() => setFilterOpen((v) => !v)}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
                filterPriority ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
              )}
              aria-label="筛选"
            >
              <Funnel className="h-4 w-4" />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-32 rounded-lg border border-black/10 bg-white py-1 shadow-md">
                  {PRIORITY_FILTERS.map((p) => (
                    <button
                      key={p ?? "all"}
                      onClick={() => {
                        setFilterPriority(p);
                        setFilterOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                        filterPriority === p ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
                      )}
                    >
                      {p === null ? "全部优先级" : `${PRIORITY_FILTER_LABEL[p]}优先级`}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* 排序（循环切换：按截止日期 → 按标题 → 取消） */}
          <button
            title={sortMode === "due" ? "当前按截止日期排序，点击改按标题" : sortMode === "title" ? "当前按标题排序，点击取消" : "按截止日期排序"}
            onClick={() => setSortMode((m) => (m === null ? "due" : m === "due" ? "title" : null))}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-md transition-colors",
              sortMode ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted",
            )}
            aria-label="排序"
          >
            <ListFilter className="h-4 w-4" />
          </button>

          {/* 添加任务 */}
          <button
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            添加任务
          </button>
        </div>
      </div>

      {/* 添加任务表单（内联） */}
      {adding && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-black/5 bg-muted/20 px-4 py-2.5">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="任务标题…"
            className="w-64 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#303030] outline-none focus:border-[#303030]/30"
          />
          <select
            value={newPriority}
            onChange={(e) => setNewPriority(e.target.value as Priority)}
            className="rounded-md border border-border bg-white px-2 py-1.5 text-xs text-[#303030] outline-none"
            aria-label="优先级"
          >
            <option value="high">优先级：高</option>
            <option value="medium">优先级：中</option>
            <option value="low">优先级：低</option>
          </select>
          <input
            value={newDue}
            onChange={(e) => setNewDue(e.target.value)}
            placeholder="截止日期（如 7月20日）"
            className="w-36 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#303030] outline-none focus:border-[#303030]/30"
          />
          <button
            onClick={addItem}
            className="rounded-md bg-[#303030] px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
          >
            添加
          </button>
          <button
            onClick={() => setAdding(false)}
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            取消
          </button>
        </div>
      )}

      {/* 看板列 */}
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-4">
        <div className="flex h-full gap-4">
          {COLUMNS.map((meta) => (
            <BoardColumn
              key={meta.id}
              meta={meta}
              count={itemsByColumn[meta.id].length}
              contentRef={getColumnRef(meta.id)}
            >
              {renderColumnCards(meta.id)}
            </BoardColumn>
          ))}
        </div>
      </div>

      {/* 浮动拖拽卡片 */}
      {drag && draggedItem ? (
        <div className="pointer-events-none fixed inset-0 z-[1000]">
          <div
            className="absolute rounded-lg border border-black/10 bg-white p-3 shadow-xl"
            style={{
              width: drag.width,
              transform: `translate(${drag.pointerX - drag.offsetX}px, ${drag.pointerY - drag.offsetY}px)`,
            }}
          >
            <BoardCardBody item={draggedItem} onMove={() => {}} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
