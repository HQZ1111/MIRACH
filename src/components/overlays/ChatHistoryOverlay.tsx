/**
 * ChatHistoryOverlay — 聊天记录弹窗（微信"查找聊天记录"样式）
 *
 * 顶部搜索框 + 日期（日历选当天）+ 标签页（全部/对话/图片/文件/链接/收藏）
 * + 多选（收藏/转发/分享到手机）。数据源：当前活跃会话（mock 合成日期/图片/文件）。
 * 点对话结果 → requestJump(消息索引) → ChatSection 滚动定位+闪烁。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  Copy,
  FileText,
  Link2,
  Search,
  Send,
  Share2,
  Square,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import { CalendarPopover } from "@/components/chat/CalendarPopover";
import {
  buildChatRecords,
  closeChatHistory,
  entryText,
  requestJump,
  type ChatRecordEntry,
  type ChatRecordType,
} from "@/store/chat-history";
import { $favorites, toggleFavoriteBatch, type FavoriteRecord } from "@/store/favorites";
import { $sessions } from "@/store/sessions";
import { appendSessionUserMessage } from "@/store/session-chat";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { $activeSessionId } from "@/store/session";
import { notify } from "@/lib/notify";

type Tab = "all" | "chat" | "image" | "file" | "link" | "favorite";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "chat", label: "对话" },
  { id: "image", label: "图片" },
  { id: "file", label: "文件" },
  { id: "link", label: "链接" },
  { id: "favorite", label: "收藏" },
];

const SHARE_PLATFORMS = ["微信", "Telegram", "Email", "飞书", "企业微信", "Discord", "SMS", "其他"];

/** 转义 HTML + 命中词高亮 */
function highlight(text: string, q: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!q) return esc;
  const qe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return esc.replace(new RegExp(`(${qe})`, "gi"), (m) => `<mark class="rounded-sm bg-yellow-200/80">${m}</mark>`);
}

function roleBadge(role: string): { label: string; cls: string } {
  if (role === "user") return { label: "我", cls: "bg-[#6366F1]/10 text-[#6366F1]" };
  if (role === "ai") return { label: "AI", cls: "bg-[#10B981]/10 text-[#059669]" };
  return { label: "系统", cls: "bg-muted text-muted-foreground" };
}

function fmtDateLabel(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}月${Number(d)}日`;
}

/** 收藏记录 → 伪条目（收藏 tab 渲染用） */
function favToEntry(f: FavoriteRecord): ChatRecordEntry {
  return {
    id: f.id,
    sessionId: f.sessionId,
    type: (f.type as ChatRecordType) || "chat",
    role: f.role,
    text: f.text,
    time: f.time,
    date: f.date,
    dayMs: new Date(`${f.date}T00:00:00`).getTime() || 0,
    messageIndex: -1,
    image: f.image,
    file: f.file,
    link: f.link,
  };
}

export function ChatHistoryOverlay({ onClose }: { onClose?: () => void }) {
  const close = () => (onClose ? onClose() : closeChatHistory());

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [dateFilter, setDateFilter] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [forwardOpen, setForwardOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const records = useMemo(() => buildChatRecords(), []);
  const favorites = useStore($favorites);
  const sessions = useStore($sessions);
  const activeId = useStore($activeSessionId);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 提示自动消失
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(t);
  }, [toast]);

  // ---- 筛选 ----
  const base = useMemo(() => {
    if (tab === "favorite") return favorites.map(favToEntry);
    if (tab === "all") return records;
    return records.filter((r) => r.type === tab);
  }, [tab, records, favorites]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return base.filter((r) => {
      if (dateFilter && r.date !== dateFilter) return false;
      if (!q) return true;
      return r.text.toLowerCase().includes(q) || (r.link?.url ?? "").toLowerCase().includes(q) || (r.file?.name ?? "").toLowerCase().includes(q);
    });
  }, [base, query, dateFilter]);

  // 日历上标记有消息的日期
  const markedDays = useMemo(() => new Set(base.map((r) => r.date)), [base]);

  const selectedEntries = useMemo(
    () => base.filter((r) => selected.has(r.id)),
    [base, selected],
  );

  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  // ---- 动作 ----
  const doFavorite = () => {
    const added = selectedEntries.filter((e) => !favorites.some((f) => f.id === e.id)).length;
    toggleFavoriteBatch(selectedEntries);
    setSelected(new Set());
    setToast(added > 0 ? `已收藏 ${added} 条` : "已取消收藏");
  };

  const doForward = (targetId: string) => {
    const text = selectedEntries.map((e) => `[转发] ${entryText(e)}`).join("\n\n");
    if (text.trim()) {
      if (MOCK) {
        appendSessionUserMessage(targetId, text);
      } else {
        // 真实模式：目标会话消息在引擎侧，转发 = 向目标会话提交该内容
        void getApi()
          .submitPrompt(targetId, text)
          .catch(() => notify("转发失败", "引擎不可达，内容未送达"));
      }
    }
    setForwardOpen(false);
    setSelected(new Set());
    setSelectMode(false);
    notify("已转发", `转发到「${sessions.find((s) => s.id === targetId)?.title ?? "会话"}」`);
  };

  const doShare = (platform: string) => {
    const text = selectedEntries.map((e) => entryText(e)).join("\n\n");
    void navigator.clipboard.writeText(text).catch(() => {});
    setShareOpen(false);
    setToast(`已发送到 ${platform}，内容已复制（可粘贴到手机端 ${platform}）`);
    notify(`已发送到 ${platform}`, "内容已复制到剪贴板");
  };

  const onRowClick = (r: ChatRecordEntry) => {
    if (selectMode) {
      toggleSelect(r.id);
      return;
    }
    if (r.type === "chat" && r.messageIndex >= 0) {
      requestJump(r.messageIndex);
      close();
      return;
    }
    if (r.type === "image" && r.image?.url) {
      const url = r.image.url;
      void openUrl(url).catch(() => window.open(url, "_blank"));
      return;
    }
    if (r.type === "link" && r.link?.url) {
      const url = r.link.url;
      void openUrl(url).catch(() => window.open(url, "_blank"));
      return;
    }
    // file / 无跳转目标：多选模式外无操作
  };

  return (
    <OverlayShell title="聊天记录" onClose={close} width={720} height={600}>
      <div className="flex h-full flex-col">
        {/* 顶部：搜索 + 日期 + 多选 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-white px-2.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索当前会话的对话、图片、文件、链接…"
              className="min-w-0 flex-1 bg-transparent py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-[#303030]">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* 日期按钮 + 日历弹层 */}
          <div className="relative shrink-0">
            <button
              onClick={() => setCalendarOpen((v) => !v)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-body-sm transition-colors",
                dateFilter ? "border-[#6366F1]/40 bg-[#6366F1]/5 text-[#464646]" : "border-border text-[#464646] hover:bg-muted",
              )}
            >
              <CalendarIcon className="h-4 w-4" strokeWidth={2} />
              {dateFilter ? fmtDateLabel(dateFilter) : "日期"}
            </button>
            {calendarOpen && (
              <CalendarPopover
                month={month}
                onMonthChange={setMonth}
                marked={markedDays}
                selected={dateFilter}
                onSelect={(d) => setDateFilter(d)}
                onClose={() => setCalendarOpen(false)}
              />
            )}
          </div>

          {/* 多选开关 */}
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-body-sm transition-colors",
              selectMode ? "border-[#6366F1]/40 bg-[#6366F1]/5 text-[#6366F1]" : "border-border text-[#464646] hover:bg-muted",
            )}
          >
            {selectMode ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            多选
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border px-4 py-1.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-md px-2.5 py-1 text-body-sm transition-colors",
                tab === t.id ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground hover:text-[#464646]",
              )}
            >
              {t.label}
            </button>
          ))}
          <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
            {filtered.length} 条{dateFilter ? ` · ${fmtDateLabel(dateFilter)}` : ""}
          </span>
        </div>

        {/* 结果列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:thin]">
          {filtered.length === 0 && (
            <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">没有匹配的记录</p>
          )}
          {filtered.map((r) => (
            <ResultRow
              key={r.id}
              entry={r}
              query={query}
              selectMode={selectMode}
              selected={selected.has(r.id)}
              onClick={() => onRowClick(r)}
            />
          ))}
        </div>

        {/* 多选工具条 */}
        {selectMode && (
          <div className="flex shrink-0 items-center gap-2 border-t border-border bg-muted/30 px-4 py-2">
            <span className="text-body-sm text-[#464646]">已选 {selected.size} 条</span>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={doFavorite} className="flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted">
                <Star className="h-3.5 w-3.5" /> 收藏
              </button>
              <button
                onClick={() => { if (selected.size > 0) setForwardOpen(true); }}
                disabled={selected.size === 0}
                className="flex items-center gap-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
              >
                <Send className="h-3.5 w-3.5" /> 转发
              </button>
              <button
                onClick={() => { if (selected.size > 0) setShareOpen(true); }}
                disabled={selected.size === 0}
                className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#464646] disabled:opacity-40"
              >
                <Share2 className="h-3.5 w-3.5" /> 分享到手机
              </button>
              <button
                onClick={() => { setSelectMode(false); setSelected(new Set()); }}
                className="flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" /> 取消
              </button>
            </div>
          </div>
        )}

        {/* toast */}
        {toast && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-[#303030] px-3 py-1.5 text-xs text-white shadow-lg">
            {toast}
          </div>
        )}

        {/* 转发弹层 */}
        {forwardOpen && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setForwardOpen(false)} />
            <div className="panel-glass popup-anim relative w-72 rounded-2xl p-3">
              <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">转发到会话（共 {selected.size} 条）</p>
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {sessions.filter((s) => !s.archived && s.id !== activeId).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => doForward(s.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                  >
                    <Send className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{s.title}</span>
                  </button>
                ))}
                {sessions.filter((s) => !s.archived && s.id !== activeId).length === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">没有其他会话可转发</p>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(selectedEntries.map((e) => entryText(e)).join("\n\n")).catch(() => {});
                    setForwardOpen(false);
                    setToast("已复制到剪贴板");
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
                >
                  <Copy className="h-3.5 w-3.5" /> 复制
                </button>
                <button onClick={() => setForwardOpen(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">
                  取消
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 分享到手机弹层 */}
        {shareOpen && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setShareOpen(false)} />
            <div className="panel-glass popup-anim relative w-80 rounded-2xl p-3">
              <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">
                分享到手机（共 {selected.size} 条 · 发送后内容复制到剪贴板）
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {SHARE_PLATFORMS.map((p) => (
                  <button
                    key={p}
                    onClick={() => doShare(p)}
                    className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2 text-body-sm text-[#303030] transition-colors hover:bg-muted"
                  >
                    <Share2 className="h-3.5 w-3.5 text-muted-foreground" />
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </OverlayShell>
  );
}

// ----------------------------------------------------------------
// 结果行
// ----------------------------------------------------------------

function ResultRow({
  entry: r,
  query,
  selectMode,
  selected,
  onClick,
}: {
  entry: ChatRecordEntry;
  query: string;
  selectMode: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const q = query.trim();
  const badge = roleBadge(r.role);
  const isFav = useStore($favorites).some((f) => f.id === r.id);

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2.5 px-4 py-2 text-left transition-colors",
        selected ? "bg-[#6366F1]/5" : "hover:bg-muted/60",
      )}
    >
      {/* 多选勾选 */}
      {selectMode && (
        <span className="mt-0.5 shrink-0 text-[#6366F1]">
          {selected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4 text-muted-foreground" />}
        </span>
      )}

      {/* 类型图标 / 图片缩略图 */}
      {r.type === "image" && r.image?.url ? (
        <img
          src={r.image.url}
          alt={r.text}
          className="h-12 w-16 shrink-0 rounded-md object-cover"
          style={{ aspectRatio: "16 / 10" }}
        />
      ) : r.type === "file" ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#6366F1]/10 text-[#6366F1]">
          <FileText className="h-4 w-4" />
        </span>
      ) : r.type === "link" ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#10B981]/10 text-[#059669]">
          <Link2 className="h-4 w-4" />
        </span>
      ) : (
        <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-medium", badge.cls)}>
          {badge.label}
        </span>
      )}

      {/* 内容 */}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          {r.type === "chat" ? (
            <span
              className="line-clamp-2 text-xs leading-snug text-[#303030]"
              dangerouslySetInnerHTML={{ __html: highlight(r.text, q) }}
            />
          ) : (
            <span
              className="truncate text-xs text-[#303030]"
              dangerouslySetInnerHTML={{ __html: highlight(r.text, q) }}
            />
          )}
          {isFav && <Star className="h-3 w-3 shrink-0 fill-[#F59E0B] text-[#F59E0B]" />}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[10px] tabular-nums text-muted-foreground">
          <span>{r.time}</span>
          <span>{fmtDateLabel(r.date)}</span>
          {r.type === "file" && r.file && <span>{r.file.size}</span>}
          {r.type === "link" && r.link && <span className="truncate text-[#6366F1]">{r.link.url}</span>}
        </span>
      </span>
    </button>
  );
}
