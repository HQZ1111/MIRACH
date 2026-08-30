/**
 * PluginsOverlay — 插件管理器（S3-5，对应原型 plugins-settings）
 *
 * 两个标签：已安装（启停/卸载）+ 可安装目录（安装）。
 * 数据走 $plugins store（localStorage 持久化）；主面板标题区图标同步读取。
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import { Download, LayoutTemplate, Package, Search, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import { getApi } from "@/lib/api";
import { getPluginViewPages } from "@/plugins/registry";
import {
  $plugins,
  installPlugin,
  PLUGIN_CATALOG,
  togglePlugin,
  uninstallPlugin,
} from "@/store/plugins";

function SwitchButton({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        "flex h-[18px] w-8 shrink-0 items-center rounded-full px-[2px] transition-colors",
        on ? "justify-end bg-[#303030]" : "justify-start bg-[#D1D5DB]",
      )}
    >
      <span className="h-[14px] w-[14px] rounded-full bg-white shadow-sm" />
    </button>
  );
}

export function PluginsOverlay({
  onClose,
  onOpenPluginView,
}: {
  onClose: () => void;
  /** 打开插件注册的独立页面（viewPage 扩展路由） */
  onOpenPluginView?: (viewId: string) => void;
}) {
  const plugins = useStore($plugins);
  const [tab, setTab] = useState<"installed" | "catalog" | "engine">("installed");
  const [query, setQuery] = useState("");
  // 注册表里带独立页面的插件（代码级贡献点，与 store 插件并列展示）
  const viewPages = useMemo(() => getPluginViewPages(), []);

  // 引擎插件清单（真实 cordis 装配镜像，sidecar config.pluginEntries）
  const [enginePlugins, setEnginePlugins] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    if (tab !== "engine") return;
    let alive = true;
    void getApi()
      .listEnginePlugins()
      .then((list: { id: string; name: string }[]) => {
        if (alive) setEnginePlugins(list);
      })
      .catch(() => {
        if (alive) setEnginePlugins([]);
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  const q = query.trim().toLowerCase();

  const engineFiltered = useMemo(() => {
    if (!enginePlugins) return null;
    if (!q) return enginePlugins;
    return enginePlugins.filter((e) => e.id.toLowerCase().includes(q) || e.name.toLowerCase().includes(q));
  }, [enginePlugins, q]);
  const installed = useMemo(
    () => (q ? plugins.filter((p) => p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)) : plugins),
    [plugins, q],
  );

  const catalog = useMemo(() => {
    const installedIds = new Set(plugins.map((p) => p.id));
    const notInstalled = PLUGIN_CATALOG.filter((p) => !installedIds.has(p.id));
    return q ? notInstalled.filter((p) => p.label.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q)) : notInstalled;
  }, [plugins, q]);

  return (
    <OverlayShell
      title="插件"
      onClose={onClose}
      width={820}
      height={600}
      titleExtra={
        <div className="flex items-center gap-1 rounded-md border border-border bg-muted/40 p-0.5">
          {(["installed", "catalog", "engine"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "rounded px-2.5 py-0.5 text-xs font-medium transition-colors",
                tab === t ? "bg-[#303030] text-white" : "text-muted-foreground hover:text-[#303030]",
              )}
            >
              {t === "installed" ? `已安装 ${plugins.length}` : t === "catalog" ? "插件目录" : "引擎插件"}
            </button>
          ))}
        </div>
      }
    >
      <div className="flex h-full flex-col">
        <div className="shrink-0 p-3 pb-2">
          <div className="relative">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件…"
              className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
            />
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tab === "engine" ? (
            engineFiltered === null ? (
              <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">正在读取引擎插件…</p>
            ) : engineFiltered.length === 0 ? (
              <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">
                {query ? "没有匹配的插件" : "引擎插件清单为空"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {engineFiltered.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                      <Package className="h-4 w-4" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body-sm font-medium text-[#303030]">{e.id}</p>
                      <p className="truncate text-[11px] text-muted-foreground">{e.name}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#6366F1]/10 px-2 py-0.5 text-[10px] text-[#6366F1]">引擎装配</span>
                  </div>
                ))}
              </div>
            )
          ) : tab === "installed" ? (
            <>
              {installed.length === 0 ? (
                <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">
                  {query ? "没有匹配的插件" : "暂无插件 — 到「插件目录」安装"}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {installed.map((p) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                        <Package className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-medium text-[#303030]">{p.label}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{p.desc}</p>
                      </div>
                      <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground sm:block">
                        {p.category}
                      </span>
                      <SwitchButton on={p.enabled} onChange={() => togglePlugin(p.id)} />
                      <button
                        onClick={() => uninstallPlugin(p.id)}
                        title="卸载"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* 扩展页面：插件注册表 viewPage 贡献点（代码级插件） */}
              {viewPages.length > 0 && (
                <div className="mt-3">
                  <p className="px-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
                    扩展页面（插件路由）
                  </p>
                  <div className="space-y-1.5">
                    {viewPages.map(({ pluginId, page }) => (
                      <div
                        key={pluginId}
                        className="flex items-center gap-3 rounded-md border border-dashed border-border/80 px-3 py-2.5"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                          <LayoutTemplate className="h-4 w-4" strokeWidth={2} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-sm font-medium text-[#303030]">{page.label}</p>
                          <p className="truncate text-[11px] text-muted-foreground">
                            由插件「{pluginId}」注册 · 路由 {page.id}
                          </p>
                        </div>
                        <button
                          onClick={() => onOpenPluginView?.(page.id)}
                          className="flex shrink-0 items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-opacity hover:opacity-90"
                        >
                          打开
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : catalog.length === 0 ? (
            <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">
              {query ? "没有匹配的插件" : "目录已全部安装 🎉"}
            </p>
          ) : (
            <div className="space-y-1.5">
              {catalog.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                    <Package className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm font-medium text-[#303030]">{p.label}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{p.desc}</p>
                  </div>
                  <span className="hidden rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground sm:block">
                    {p.category}
                  </span>
                  <button
                    onClick={() => installPlugin(p.id)}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-[#303030] transition-colors hover:bg-muted"
                  >
                    <Download className="h-3 w-3" strokeWidth={2} />
                    安装
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          主面板标题区的插件图标仅显示已启用插件；真实插件市场 / 本地目录扫描随 Rust 层接入。
        </p>
      </div>
    </OverlayShell>
  );
}
