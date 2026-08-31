/**
 * PluginsOverlay — 插件管理器（真实化：社区插件一键安装）
 *
 * 三个标签：
 *   已安装  — dsh-plugins 目录扫描（plugins.list）：包名/版本/描述 + 激活状态
 *             + 卸载（内置三件禁用卸载）
 *   安装    — npm 包名输入（如 dsh-tavern）→ plugins.install（npm → junction →
 *             patch 追加，步骤日志实时展示）
 *   引擎插件 — cordis 装配清单（config.pluginEntries）
 *
 * 装载发生在 runtime 启动：安装/卸载后需重启应用生效。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { Download, LayoutTemplate, Package, RefreshCw, Search, Trash2 } from "lucide-react";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import { getApi } from "@/lib/api";
import type { InstalledPluginInfo } from "@/lib/api/client";
import { getPluginViewPages } from "@/plugins/registry";

interface NpmResult {
  name: string;
  version: string;
  description: string;
}

type Installed = InstalledPluginInfo;

function SwitchBadge({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[10px]",
        active ? "bg-[#10B981]/10 text-[#059669]" : "bg-muted text-muted-foreground",
      )}
    >
      {active ? "已激活" : "未激活"}
    </span>
  );
}

export function PluginsOverlay({
  onClose,
  onOpenPluginView,
}: {
  onClose: () => void;
  /** 打开插件注册的独立页面（viewId 扩展路由） */
  onOpenPluginView?: (viewId: string) => void;
}) {
  const [tab, setTab] = useState<"installed" | "catalog" | "engine">("installed");
  const [query, setQuery] = useState("");
  // 注册表里带独立页面的插件（代码级贡献点）
  const viewPages = useMemo(() => getPluginViewPages(), []);

  const [installed, setInstalled] = useState<Installed[] | null>(null);
  const [installName, setInstallName] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  // npm 市场发现（registry 搜索，Rust fetch_text 绕 CORS）
  const [npmQuery, setNpmQuery] = useState("");
  const [npmResults, setNpmResults] = useState<NpmResult[] | null>(null);
  const [npmBusy, setNpmBusy] = useState(false);

  const searchNpm = async (): Promise<void> => {
    const q = (npmQuery.trim() || "dsh") + " keywords:dsh-plugin";
    setNpmBusy(true);
    try {
      const text = await invoke<string>("fetch_text", {
        url: `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=25`,
      });
      const data = JSON.parse(text) as { objects?: { package: { name: string; version: string; description?: string } }[] };
      setNpmResults(
        (data.objects ?? []).map((o) => ({
          name: String(o.package.name),
          version: String(o.package.version ?? ""),
          description: String(o.package.description ?? ""),
        })),
      );
    } catch {
      setNpmResults([]);
    } finally {
      setNpmBusy(false);
    }
  };

  const installNamed = async (name: string): Promise<void> => {
    setBusy(true);
    setLogs([`安装 ${name} …`]);
    setTab("catalog");
    try {
      const lines = await getApi().installCommunityPlugin(name);
      setLogs(lines);
      refresh();
    } catch (e) {
      setLogs((l) => [...l, "失败：" + String(e)]);
    } finally {
      setBusy(false);
    }
  };

  const refresh = useCallback(() => {
    void getApi()
      .listCommunityPlugins()
      .then((list) => setInstalled(list))
      .catch(() => setInstalled([]));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const doInstall = async (): Promise<void> => {
    const name = installName.trim();
    if (!name) return;
    await installNamed(name);
  };

  const doUninstall = async (name: string): Promise<void> => {
    if (!window.confirm(`卸载插件「${name}」？重启应用后生效。`)) return;
    setBusy(true);
    setLogs([`卸载 ${name} …`]);
    try {
      const lines = await getApi().uninstallCommunityPlugin(name);
      setLogs(lines);
      refresh();
    } catch (e) {
      setLogs((l) => [...l, "失败：" + String(e)]);
    } finally {
      setBusy(false);
    }
  };

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
  const installedFiltered = useMemo(() => {
    if (!installed) return null;
    if (!q) return installed;
    return installed.filter((p) => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q));
  }, [installed, q]);

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
              {t === "installed" ? `已安装 ${installed?.length ?? "…"}` : t === "catalog" ? "安装" : "引擎插件"}
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
              {installedFiltered === null ? (
                <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">正在读取…</p>
              ) : installedFiltered.length === 0 ? (
                <p className="px-3 py-8 text-center text-body-sm text-muted-foreground">
                  {query ? "没有匹配的插件" : "暂无社区插件 — 到「安装」页签输入 npm 包名"}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {installedFiltered.map((p) => (
                    <div key={p.name} className="flex items-center gap-3 rounded-md border border-border/60 px-3 py-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[#464646]">
                        <Package className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body-sm font-medium text-[#303030]">
                          {p.name}
                          {p.version && <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">{p.version}</span>}
                          {p.builtin && <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">内置</span>}
                          {!p.isPlugin && <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">依赖包</span>}
                        </p>
                        <p className="truncate text-[11px] text-muted-foreground">{p.description || "—"}</p>
                      </div>
                      {p.isPlugin && <SwitchBadge active={p.active} />}
                      <button
                        onClick={() => void doUninstall(p.name)}
                        disabled={p.builtin || busy}
                        title={p.builtin ? "内置插件不可卸载" : "卸载（重启后生效）"}
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#EF4444] disabled:cursor-not-allowed disabled:opacity-40"
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
          ) : (
            <>
              <div className="rounded-lg border border-border/60 p-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  从 npm 发现社区插件（搜索 dsh 相关包），或直接输入包名安装。
                  安装 = 装包到插件目录 + 自动激活（junction + 补丁行），<b>重启应用后生效</b>。
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={npmQuery}
                    onChange={(e) => setNpmQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !npmBusy && void searchNpm()}
                    placeholder="搜索 npm（如 tavern / workgroup / 记忆，默认 dsh）"
                    className="min-w-0 flex-1 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] text-[#303030] outline-none focus:border-[#6366F1]"
                  />
                  <button
                    onClick={() => void searchNpm()}
                    disabled={npmBusy}
                    className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted disabled:opacity-50"
                  >
                    <Search className="h-3.5 w-3.5" />
                    {npmBusy ? "搜索中…" : "发现"}
                  </button>
                </div>
                {npmResults !== null && (
                  <div className="mt-2 max-h-52 space-y-1 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {npmResults.length === 0 ? (
                      <p className="py-2 text-center text-[11px] text-muted-foreground">没有匹配结果</p>
                    ) : (
                      npmResults.map((r) => (
                        <div key={r.name} className="flex items-center gap-2 rounded-md border border-black/5 bg-muted/30 px-2.5 py-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[11px] font-medium text-[#303030]">
                              {r.name}
                              <span className="ml-1.5 font-mono text-[10px] font-normal text-muted-foreground">{r.version}</span>
                            </p>
                            <p className="truncate text-[10px] text-muted-foreground">{r.description}</p>
                          </div>
                          <button
                            onClick={() => void installNamed(r.name)}
                            disabled={busy}
                            className="shrink-0 rounded-md bg-[#303030] px-2 py-0.5 text-[10px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            安装
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="mt-2 rounded-lg border border-border/60 p-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  已知包名直装：
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    value={installName}
                    onChange={(e) => setInstallName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !busy && void doInstall()}
                    placeholder="npm 包名（如 dsh-tavern 或 dsh-tavern@1.0.0）"
                    className="min-w-0 flex-1 rounded-md border border-border bg-white px-2.5 py-1.5 font-mono text-[12px] text-[#303030] outline-none focus:border-[#6366F1]"
                  />
                  <button
                    onClick={() => void doInstall()}
                    disabled={busy || !installName.trim()}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                    {busy ? "安装中…" : "安装"}
                  </button>
                </div>
                {logs.length > 0 && (
                  <pre className="mt-2 max-h-32 overflow-y-auto rounded-md bg-black/5 p-2 font-mono text-[10px] leading-relaxed text-[#303030] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {logs.join("\n")}
                  </pre>
                )}
              </div>
              <p className="mt-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
                提示：社区插件都是 npm 包（dsh- 前缀）；安装后到「已安装」查看激活状态。
                需要界面扩展（如酒馆管理面板）的插件，重启后在其设置入口出现。
              </p>
              <button
                onClick={refresh}
                className="mt-2 flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
              >
                <RefreshCw className="h-3 w-3" />
                刷新列表
              </button>
            </>
          )}
        </div>

        <p className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
          插件装载发生在引擎启动时：安装 / 卸载后需重启应用生效。
        </p>
      </div>
    </OverlayShell>
  );
}
