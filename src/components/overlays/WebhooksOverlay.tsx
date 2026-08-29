/**
 * WebhooksOverlay — Webhook 订阅管理面板（S3-5，对应原型 webhooks 页）
 *
 * 左右分栏：左侧订阅列表（搜索/启用开关/删除），右侧详情（URL/事件/投递/说明）。
 * 数据走 $webhooks store（localStorage 持久化）；真实投递由后端 Webhook 服务完成。
 */

import { useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Check, Copy, Globe, Plus, Search, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import {
  $webhooks,
  addWebhook,
  removeWebhook,
  toggleWebhook,
} from "@/store/webhooks";

const DELIVER_OPTIONS = ["log", "telegram", "discord", "slack", "email", "github_comment"];

export function WebhooksOverlay({ onClose }: { onClose: () => void }) {
  const webhooks = useStore($webhooks);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  // ---- 新建表单 ----
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState("");
  const [deliver, setDeliver] = useState("log");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return webhooks;
    return webhooks.filter(
      (w) =>
        w.name.toLowerCase().includes(q) ||
        w.url.toLowerCase().includes(q) ||
        w.events.toLowerCase().includes(q),
    );
  }, [webhooks, query]);

  const selected = filtered.find((w) => w.id === selectedId) ?? filtered[0] ?? null;

  const copyUrl = (text: string) => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const submitCreate = () => {
    if (!name.trim() || !url.trim()) return;
    addWebhook({
      name: name.trim(),
      url: url.trim(),
      events: events.trim(),
      deliver: DELIVER_OPTIONS.includes(deliver) ? deliver : "log",
    });
    setName("");
    setUrl("");
    setEvents("");
    setDeliver("log");
    setCreateOpen(false);
  };

  return (
    <OverlayShell
      title="Webhook 订阅"
      onClose={onClose}
      width={980}
      height={640}
      titleExtra={
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#464646]"
        >
          <Plus className="h-3.5 w-3.5" />
          新建订阅
        </button>
      }
    >
      <div className="relative flex h-full">
        {/* ---- 左栏：订阅列表 ---- */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="p-3 pb-2">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索订阅…"
                className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
              />
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-body-sm text-muted-foreground">
                暂无订阅{query ? `（匹配 "${query}"）` : ""}
              </p>
            ) : (
              filtered.map((w) => (
                <div
                  key={w.id}
                  className={cn(
                    "group mb-1 flex items-center gap-2 rounded-md px-2 py-2 transition-colors",
                    selected?.id === w.id ? "bg-muted" : "hover:bg-muted/60",
                  )}
                >
                  <button
                    onClick={() => setSelectedId(w.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        w.enabled ? "bg-[#10B981]" : "bg-[#9CA3AF]",
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[#303030]">
                      {w.name}
                    </span>
                  </button>
                  <button
                    onClick={() => toggleWebhook(w.id)}
                    title={w.enabled ? "停用" : "启用"}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-border hover:text-[#303030] group-hover:opacity-100"
                  >
                    <Globe className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => {
                      removeWebhook(w.id);
                      if (selected?.id === w.id) setSelectedId(null);
                    }}
                    title="删除"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-border hover:text-[#EF4444] group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ---- 右栏：详情 / 空态 ---- */}
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!selected ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
              <Globe className="h-10 w-10 text-muted-foreground/40" strokeWidth={1.5} />
              <p className="text-member font-medium text-[#303030]">还没有 Webhook 订阅</p>
              <p className="max-w-sm text-body-sm text-muted-foreground">
                点击右上角「新建订阅」，把 Mirach 事件（deploy.completed、daily.summary 等）转发到
                Telegram / Discord / Slack / 邮箱等投递目标。
              </p>
            </div>
          ) : (
            <div className="px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-member font-bold text-[#303030]">{selected.name}</h3>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className={cn("rounded-full px-2 py-0.5 font-medium", selected.enabled ? "bg-emerald-50 text-[#059669]" : "bg-muted text-[#6B7280]")}>
                      {selected.enabled ? "已启用" : "已停用"}
                    </span>
                    <span>投递到 {selected.deliver}</span>
                  </p>
                </div>
                <button
                  onClick={() => toggleWebhook(selected.id)}
                  className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-[#303030] transition-colors hover:bg-muted"
                >
                  {selected.enabled ? "停用" : "启用"}
                </button>
              </div>

              {/* URL（可复制） */}
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Webhook URL</p>
                <div className="mt-1 flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2.5 py-1.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-[#303030]">{selected.url}</code>
                  <button
                    onClick={() => copyUrl(selected.url)}
                    title="复制"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                  >
                    {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>

              {/* 事件 */}
              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">订阅事件</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {selected.events
                    ? selected.events.split(",").map((e) => e.trim()).filter(Boolean).map((e) => (
                        <span key={e} className="rounded-full border border-border bg-white px-2 py-0.5 font-mono text-[11px] text-[#303030]">
                          {e}
                        </span>
                      ))
                    : <span className="text-body-sm text-muted-foreground">全部事件</span>}
                </div>
              </div>

              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
                真实投递由后端 Webhook 服务完成（部署事件 / 每日摘要 / 代码评审通知等）。
                当前为本地演示数据，前端只做管理 UI + 持久化。
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ---- 新建订阅对话框 ---- */}
      {createOpen && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/30 backdrop-blur-md">
          <div className="panel-glass popup-anim w-[420px] rounded-2xl p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-member font-bold text-[#303030]">新建 Webhook 订阅</h3>
              <button
                onClick={() => setCreateOpen(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-[#464646]">名称</label>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如：Deploy notifications"
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#303030]/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#464646]">URL</label>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://…"
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 font-mono text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#303030]/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#464646]">事件（逗号分隔，留空 = 全部）</label>
                <input
                  value={events}
                  onChange={(e) => setEvents(e.target.value)}
                  placeholder="deploy.completed, daily.summary"
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 font-mono text-body-sm text-[#303040] outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-[#303030]/10"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#464646]">投递目标</label>
                <select
                  value={deliver}
                  onChange={(e) => setDeliver(e.target.value)}
                  className="w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none focus:ring-2 focus:ring-[#303030]/10"
                >
                  {DELIVER_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setCreateOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-[#303030] transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={submitCreate}
                disabled={!name.trim() || !url.trim()}
                className="flex items-center gap-1 rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#464646] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="h-3 w-3" />
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </OverlayShell>
  );
}
