/**
 * AgentTeam — 智能体团队面板（按环境实例化，嵌入环境设置面板）
 *
 * 一个 AgentTeamPanel = 一个环境的完整团队管理：
 *   - 成员卡片网格（添加/编辑/删除）+ 团队模板导入/导出
 *   - 聊天环境专属：酒馆管理（原生）面板（在成员列表上方）+ 导入酒馆角色
 *     （角色库/在线市场/酒馆预设/角色卡文件）+ 世界书编辑
 * 数据走 agents store 的按环境分片读写（loadAgentsOf/saveAgentsOf/*In）。
 * 环境隐藏（visible=false）时团队不生效——面板顶部给出提示。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { Pencil, Plus, Search, Trash2, Upload, Users, X } from "lucide-react";
import { nativeTavernSection, kernelContext } from "@/dsh-kernel/boot";
import { userHomeDir } from "@/lib/paths";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  loadAgentsOf,
  saveAgentsOf,
  addAgentIn,
  updateAgentIn,
  removeAgentIn,
  upsertTavernMember,
  TAVERN_MEMBER_ENV,
  type ConvItem,
} from "@/store/agents";
import { $providerConfig } from "@/store/providerConfig";
import { $groups, createGroup, removeGroup, type GroupMode } from "@/store/groups";
import {
  listTavernPresets,
  parseCharacterCard,
  parseCharacterCardPng,
  cardToPersona,
  presetToPersona,
  tavernPresetsRoot,
  readWorldbook,
  writeWorldbook,
  type TavernPreset,
  type Worldbook,
  type WbEntry,
  type WbGroup,
} from "@/lib/tavern";
import { BUILTIN_CHARACTERS, CHARACTER_CATEGORIES, type BuiltinCharacter } from "@/lib/tavern-characters";
import {
  DEFAULT_MARKET_SOURCES,
  addCustomSource,
  allSources,
  cachedPack,
  fetchPack,
  loadCache,
  removeCustomSource,
  type MarketCacheEntry,
  type MarketSource,
} from "@/lib/character-market";
import type { EnvProfile } from "@/store/environments";

// ================================================================
// NativeTavernPanel — 酒馆管理（原生）面板
// 渲染酒馆插件 client bundle 注册进 settings.section 槽位的官方面板
// （boot.ts 经 kernel 加载 bundle 并提供 slots/locale shim）。
// 插件 CSS 依赖官方 --dsw-alias-* 令牌 → 宿主容器补齐变量；否则颜色错乱。
// ================================================================

/** 官方 dsw alias 令牌 → mirach 浅色值（原生面板样式依赖；导出供设置页官方分区复用） */
export const DSW_ALIAS_VARS = {
  "--dsw-alias-label-primary": "#303030",
  "--dsw-alias-label-secondary": "#6B7280",
  "--dsw-alias-label-caption": "#8B8C8F",
  "--dsw-alias-label-tertiary": "#8B8C8F",
  "--dsw-alias-border-l1": "#E5E7EB",
  "--dsw-alias-border-l2": "#E5E7EB",
  "--dsw-alias-border-default": "#D1D5DB",
  "--dsw-alias-bg-base": "#1A1A1A",
  "--dsw-alias-bg-layer-1": "#FFFFFF",
  "--dsw-alias-bg-layer-2": "#F5F6F8",
  "--dsw-alias-brand-primary": "#017CF3",
  "--dsw-alias-state-business-primary": "#017CF3",
  "--dsw-alias-state-error-primary": "#EF4444",
  "--dsw-alias-state-success-primary": "#10B981",
  "--dsw-font-base": '13px/1.5 "Segoe UI", "Microsoft YaHei", sans-serif',
} as React.CSSProperties;

/** 原生面板控件的对齐样式（按钮/输入框与 mirach 设置页一致） */
const NATIVE_HOST_CSS = `
.tavern-native-host #tavern-manager h2 { font-size: 15px; font-weight: 700; margin: 0 0 10px; }
.tavern-native-host #tavern-manager .t-card { border-radius: 10px; padding: 12px 14px; }
.tavern-native-host #tavern-manager .t-card-title { font-size: 13px; }
.tavern-native-host #tavern-manager button { font-size: 12px; padding: 5px 12px; border-radius: 8px; }
.tavern-native-host #tavern-manager .t-btn-secondary { border-radius: 8px; }
.tavern-native-host #tavern-manager input[type="text"],
.tavern-native-host #tavern-manager input:not([type]),
.tavern-native-host #tavern-manager select,
.tavern-native-host #tavern-manager textarea {
  border-radius: 8px; border: 1px solid #E5E7EB; padding: 5px 8px;
  font-size: 12px; color: #303030; background: #fff; outline: none;
}
.tavern-native-host #tavern-manager input:focus,
.tavern-native-host #tavern-manager select:focus,
.tavern-native-host #tavern-manager textarea:focus { border-color: #6366F1; }
.tavern-native-host #tavern-manager table { width: 100%; font-size: 12px; border-collapse: collapse; }
.tavern-native-host #tavern-manager th, .tavern-native-host #tavern-manager td {
  padding: 4px 6px; border-bottom: 1px solid #F0F0F0; text-align: left;
}
`;

function NativeTavernPanel() {
  const [entry, setEntry] = useState<{ id: string; label: string; render: (props: unknown) => unknown } | null>(() =>
    nativeTavernSection(),
  );
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (entry) return;
    const t = window.setTimeout(() => {
      setEntry(nativeTavernSection());
      setTick((v) => v + 1);
    }, 1200);
    return () => window.clearTimeout(t);
  }, [entry, tick]);
  if (!entry) {
    return (
      <div className="rounded-lg border border-black/10 bg-white p-3">
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          原生面板未加载：需要 VITE_KERNEL=1 启动内核且酒馆插件 client bundle 可用。
          请重启应用重试。
        </p>
      </div>
    );
  }
  const el = entry.render({ ctx: kernelContext() });
  return (
    <div>
      <style>{NATIVE_HOST_CSS}</style>
      <div className="tavern-native-host rounded-lg border border-black/10 bg-white px-3 py-3" style={DSW_ALIAS_VARS}>
        {el as React.ReactElement}
      </div>
    </div>
  );
}

// ================================================================
// CharacterCard — 角色卡行（角色库/在线市场共用）
// ================================================================

function CharacterCard({
  c,
  imported,
  draft,
  expanded,
  onToggleExpand,
  onChangeDraft,
  onImport,
}: {
  c: BuiltinCharacter;
  imported: boolean;
  draft: string;
  expanded: boolean;
  onToggleExpand: () => void;
  onChangeDraft: (v: string) => void;
  onImport: () => void;
}) {
  return (
    <div className="rounded-lg border border-black/10 bg-white p-2.5">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
          style={{ backgroundColor: c.avatarBg }}
        >
          {c.name.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-[#303030]">
            {c.name}
            <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">{c.category}</span>
          </p>
          <p className="truncate text-[10px] text-muted-foreground">{c.desc}</p>
        </div>
        <button
          onClick={onToggleExpand}
          className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] hover:bg-muted"
        >
          {expanded ? "收起" : "修改"}
        </button>
        <button
          onClick={onImport}
          className={cn(
            "shrink-0 rounded-md px-2.5 py-1 text-[11px] text-white",
            imported ? "bg-[#10B981]" : "bg-[#8B5CF6] hover:bg-[#8B5CF6]/90",
          )}
        >
          {imported ? "已导入" : "导入角色"}
        </button>
      </div>
      {expanded && (
        <textarea
          value={draft}
          onChange={(e) => onChangeDraft(e.target.value)}
          rows={6}
          className="mt-2 w-full resize-y rounded-md border border-border bg-white px-2.5 py-2 text-[11px] leading-relaxed text-[#303030] outline-none focus:border-[#8B5CF6]"
        />
      )}
    </div>
  );
}

// ================================================================
// WorldbookDialog — 酒馆世界书编辑器（v2 统一格式，兼容旧版）
// ================================================================

function WorldbookDialog({
  presetKey,
  presetName,
  root,
  onClose,
}: {
  presetKey: string;
  presetName: string;
  root: string;
  onClose: () => void;
}) {
  const [wb, setWb] = useState<Worldbook | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      const w = await readWorldbook(root, presetKey);
      if (alive) setWb(w);
    })();
    return () => {
      alive = false;
    };
  }, [root, presetKey]);

  if (!wb) {
    return (
      <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40" onClick={onClose}>
        <div className="rounded-xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
          <p className="text-xs text-muted-foreground">读取中…</p>
        </div>
      </div>
    );
  }

  const patchGroup = (gi: number, patch: Partial<WbGroup>): void =>
    setWb((w) => (w ? { ...w, groups: w.groups!.map((g, i) => (i === gi ? { ...g, ...patch } : g)) } : w));
  const patchEntry = (gi: number, ei: number, patch: Partial<WbEntry>): void =>
    setWb((w) =>
      w
        ? {
            ...w,
            groups: w.groups!.map((g, i) =>
              i === gi ? { ...g, entries: g.entries.map((e, j) => (j === ei ? { ...e, ...patch } : e)) } : g,
            ),
          }
        : w,
    );
  const addEntry = (gi: number): void =>
    setWb((w) =>
      w
        ? {
            ...w,
            groups: w.groups!.map((g, i) =>
              i === gi
                ? { ...g, entries: [...g.entries, { name: "新条目", keywords: [], content: "", enabled: true }] }
                : g,
            ),
          }
        : w,
    );
  const removeEntry = (gi: number, ei: number): void =>
    setWb((w) =>
      w
        ? { ...w, groups: w.groups!.map((g, i) => (i === gi ? { ...g, entries: g.entries.filter((_, j) => j !== ei) } : g)) }
        : w,
    );
  const addGroup = (): void =>
    setWb((w) =>
      w ? { ...w, groups: [...(w.groups ?? []), { name: "新世界书", enabled: true, entries: [] }] } : w,
    );
  const save = async (): Promise<void> => {
    try {
      await writeWorldbook(root, presetKey, wb);
      setNote("已保存 ✓（该预设绑定的会话即时生效）");
    } catch (e) {
      setNote("保存失败：" + String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="max-h-[85vh] w-[600px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#303030]">世界书 — {presetName}</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              全文注入 = 条目全量进上下文；关键词触发 = 消息命中触发词才注入（省上下文）。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#303030]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 注入模式 + 分组 */}
        <div className="mt-3 flex items-center gap-1 rounded-lg bg-muted/60 p-1 text-[11px]">
          {(
            [
              ["full", "全文注入"],
              ["keyword", "关键词触发"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setWb({ ...wb, injectMode: v })}
              className={cn(
                "flex-1 rounded-md py-1 transition-colors",
                wb.injectMode === v ? "bg-white font-medium text-[#303030] shadow-sm" : "text-muted-foreground hover:text-[#303030]",
              )}
            >
              {label}
            </button>
          ))}
          <button
            onClick={addGroup}
            className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-white hover:text-[#303030]"
          >
            + 分组
          </button>
        </div>

        {/* 分组与条目 */}
        <div className="mt-3 space-y-3">
          {wb.groups!.map((g, gi) => (
            <div key={gi} className="rounded-lg border border-black/10 p-2.5">
              <div className="flex items-center gap-2">
                <input
                  value={g.name ?? ""}
                  onChange={(e) => patchGroup(gi, { name: e.target.value })}
                  className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] font-medium text-[#303030] outline-none focus:border-[#8B5CF6]"
                />
                <button
                  onClick={() => addEntry(gi)}
                  className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] hover:bg-muted"
                >
                  + 条目
                </button>
              </div>
              <div className="mt-2 space-y-2">
                {g.entries.map((e, ei) => (
                  <div key={ei} className="rounded-md border border-black/5 bg-muted/30 p-2">
                    <div className="flex items-center gap-1.5">
                      <input
                        value={e.name ?? ""}
                        onChange={(ev) => patchEntry(gi, ei, { name: ev.target.value })}
                        placeholder="条目名"
                        className="min-w-0 flex-1 rounded border border-border bg-white px-2 py-1 text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
                      />
                      <input
                        value={(e.keywords ?? []).join(", ")}
                        onChange={(ev) =>
                          patchEntry(gi, ei, {
                            keywords: ev.target.value
                              .split(/[,，]/)
                              .map((k) => k.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="触发词（逗号分隔）"
                        className="min-w-0 flex-1 rounded border border-border bg-white px-2 py-1 font-mono text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
                        <input
                          type="checkbox"
                          checked={e.enabled !== false}
                          onChange={(ev) => patchEntry(gi, ei, { enabled: ev.target.checked })}
                        />
                        启用
                      </label>
                      <button
                        onClick={() => removeEntry(gi, ei)}
                        title="删除条目"
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#EF4444]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={e.content ?? ""}
                      onChange={(ev) => patchEntry(gi, ei, { content: ev.target.value })}
                      rows={3}
                      placeholder="条目内容（注入给模型的世界观/设定文本）"
                      className="mt-1.5 w-full resize-y rounded border border-border bg-white px-2 py-1 text-[11px] leading-relaxed text-[#303030] outline-none focus:border-[#8B5CF6]"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
          {wb.groups!.length === 0 && (
            <p className="py-4 text-center text-[11px] text-muted-foreground">空世界书——点「+ 分组」开始搭建</p>
          )}
        </div>

        {note && <p className="mt-3 text-[11px] text-[#10B981]">{note}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            关闭
          </button>
          <button
            onClick={() => void save()}
            className="rounded-md bg-[#8B5CF6] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#8B5CF6]/90"
          >
            保存世界书
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// TavernImportDialog — 导入酒馆角色（角色库 / 在线市场 / 酒馆预设 / 角色卡文件）
// ================================================================

function TavernImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  const [tab, setTab] = useState<"gallery" | "market" | "presets" | "file">("gallery");
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () => new Set(loadAgentsOf(TAVERN_MEMBER_ENV).filter((a) => a.source === "tavern").map((a) => a.id)),
  );
  const [presets, setPresets] = useState<TavernPreset[] | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [cat, setCat] = useState<string>("全部");
  const [query, setQuery] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [wbEdit, setWbEdit] = useState<{ key: string; name: string } | null>(null);
  // 在线市场
  const [sources, setSources] = useState<MarketSource[]>(() => allSources());
  const [marketUrl, setMarketUrl] = useState<string>(DEFAULT_MARKET_SOURCES[0]!.url);
  const [packCache, setPackCache] = useState<Record<string, MarketCacheEntry>>(() => loadCache());
  const [marketBusy, setMarketBusy] = useState(false);
  const [newSrc, setNewSrc] = useState({ name: "", url: "" });

  /** 拖拽/选择共用导入：PNG 角色卡（tEXt chara 块）+ SillyTavern JSON 卡 */
  const importFiles = async (files: Iterable<File>): Promise<void> => {
    let ok = 0;
    for (const f of files) {
      try {
        if (/\.png$/i.test(f.name)) {
          const buf = await f.arrayBuffer();
          const card = parseCharacterCardPng(buf);
          if (!card) continue;
          importMember(
            card.name,
            card.name,
            cardToPersona(card),
            "PNG 角色卡" + (card.scenario ? " · " + card.scenario.slice(0, 24) : ""),
          );
          ok += 1;
        } else if (/\.json$/i.test(f.name)) {
          const card = parseCharacterCard(await f.text());
          if (!card) continue;
          importMember(
            card.name,
            card.name,
            cardToPersona(card),
            "角色卡 JSON" + (card.scenario ? " · " + card.scenario.slice(0, 24) : ""),
          );
          ok += 1;
        }
      } catch {
        /* 单个文件失败：跳过 */
      }
    }
    setNote(ok > 0 ? `已导入 ${ok} 个角色成员（聊天环境）` : "没有可识别的角色卡（支持 SillyTavern PNG / JSON）");
  };

  const afterImport = useCallback(
    (key: string) => {
      setImportedIds((s) => new Set(s).add(`tavern-${key}`));
      onImported?.();
    },
    [onImported],
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const root = await tavernPresetsRoot();
      if (!alive) return;
      setRootPath(root ?? "");
      const list = await listTavernPresets();
      if (alive) setPresets(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const visiblePresets = (presets ?? []).filter((p) => p.key !== "tavern-lite");

  const refreshMarket = async (url: string): Promise<void> => {
    setMarketUrl(url);
    setMarketBusy(true);
    try {
      await fetchPack(url);
      setPackCache(loadCache());
      setNote("角色包已更新 ✓");
    } catch (e) {
      setPackCache(loadCache());
      setNote("拉取失败：" + String(e) + (cachedPack(url) ? "（正在显示缓存）" : ""));
    } finally {
      setMarketBusy(false);
    }
  };
  const addSource = (): void => {
    const r = addCustomSource({ name: newSrc.name, url: newSrc.url });
    setSources(r.sources);
    setNote(r.ok ? "已添加自定义源" : r.error ?? "添加失败");
    if (r.ok) setNewSrc({ name: "", url: "" });
  };
  const removeSource = (url: string): void => {
    setSources(removeCustomSource(url));
    if (marketUrl === url) setMarketUrl(DEFAULT_MARKET_SOURCES[0]!.url);
  };
  useEffect(() => {
    if (tab === "market" && !packCache[marketUrl]) void refreshMarket(marketUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const mark = (key: string) => (importedIds.has(`tavern-${key}`) ? "已导入" : "导入角色");

  const importMember = (key: string, name: string, systemPrompt: string, desc: string, presetId?: string): void => {
    upsertTavernMember({ key, name, systemPrompt, desc, presetId });
    afterImport(key);
    setNote("已导入「" + name + "」（聊天环境成员），到左栏「成员」开聊");
  };

  const importPreset = (p: TavernPreset): void => {
    importMember(p.key, p.name, presetToPersona(p), p.description || "酒馆角色 · 预设 " + p.key, p.key);
  };

  const pickCardFiles = async (): Promise<void> => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const home = await userHomeDir();
      const picked = await open({
        multiple: true,
        title: "选择角色卡（PNG / JSON）",
        filters: [{ name: "SillyTavern 角色卡", extensions: ["png", "json"] }],
        defaultPath: home ?? undefined,
      });
      if (!picked) return;
      const paths = Array.isArray(picked) ? picked : [picked];
      let ok = 0;
      for (const path of paths) {
        try {
          if (/\.png$/i.test(path)) {
            const arr = await invoke<number[]>("read_file_bytes", { path });
            const card = parseCharacterCardPng(new Uint8Array(arr).buffer);
            if (!card) continue;
            importMember(card.name, card.name, cardToPersona(card), "PNG 角色卡" + (card.scenario ? " · " + card.scenario.slice(0, 24) : ""));
            ok += 1;
          } else if (/\.json$/i.test(path)) {
            const text = await invoke<string>("read_file", { path });
            const card = parseCharacterCard(text);
            if (!card) continue;
            importMember(card.name, card.name, cardToPersona(card), "角色卡 JSON" + (card.scenario ? " · " + card.scenario.slice(0, 24) : ""));
            ok += 1;
          }
        } catch {
          /* 单个文件读取失败：跳过 */
        }
      }
      setNote(ok > 0 ? "已导入 " + ok + " 个角色成员（聊天环境）" : "没有可识别的角色卡（支持 SillyTavern PNG / JSON）");
    } catch (e) {
      setNote("无法打开文件选择器：" + String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className={cn(
          "relative max-h-[85vh] w-[500px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          dragOver && "ring-2 ring-[#8B5CF6]",
        )}
        onClick={(e) => e.stopPropagation()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void importFiles(e.dataTransfer.files);
        }}
      >
        {dragOver && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl bg-[#8B5CF6]/10 text-sm font-medium text-[#8B5CF6]">
            松开导入角色卡（PNG / JSON）
          </div>
        )}
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#303030]">导入酒馆角色</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              角色以成员身份进入<b>聊天环境</b>的成员列表，人设作为系统提示词注入对话；同名重导只更新不重复，导入后可随时在成员「编辑」里再改。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#303030]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-3 flex gap-1 rounded-lg bg-muted/60 p-1 text-[11px]">
          {(
            [
              ["gallery", "角色库"],
              ["market", "在线市场"],
              ["presets", "酒馆预设"],
              ["file", "角色卡文件"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                "flex-1 rounded-md py-1 transition-colors",
                tab === id ? "bg-white font-medium text-[#303030] shadow-sm" : "text-muted-foreground hover:text-[#303030]",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "gallery" && (
          <div className="mt-3">
            <div className="flex flex-wrap items-center gap-1">
              {["全部", ...CHARACTER_CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => setCat(c)}
                  className={cn(
                    "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
                    cat === c
                      ? "border-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6]"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索角色…"
                className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-[12px] text-[#303030] outline-none focus:border-[#8B5CF6]"
              />
            </div>
            <div className="mt-2 max-h-[40vh] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {BUILTIN_CHARACTERS.filter((c) => (cat === "全部" || c.category === cat) && (!query.trim() || c.name.includes(query.trim()) || c.desc.includes(query.trim()))).map((c) => (
                <CharacterCard
                  key={c.key}
                  c={c}
                  imported={importedIds.has(`tavern-${c.key}`)}
                  draft={editing[c.key] ?? c.persona}
                  expanded={editing[c.key] !== undefined}
                  onToggleExpand={() =>
                    setEditing((s) => {
                      const next = { ...s };
                      if (next[c.key] !== undefined) delete next[c.key];
                      else next[c.key] = c.persona;
                      return next;
                    })
                  }
                  onChangeDraft={(v) => setEditing((s) => ({ ...s, [c.key]: v }))}
                  onImport={() => importMember(c.key, c.name, editing[c.key] ?? c.persona, c.desc)}
                />
              ))}
              {BUILTIN_CHARACTERS.filter((c) => (cat === "全部" || c.category === cat) && (!query.trim() || c.name.includes(query.trim()) || c.desc.includes(query.trim()))).length === 0 && (
                <p className="py-6 text-center text-[11px] text-muted-foreground">没有匹配的角色</p>
              )}
            </div>
          </div>
        )}

        {tab === "market" && (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              从远程源拉取角色包（JSON 格式）。默认源 = mirach 仓库的角色包，仓库发版即更新；
              也可以添加自己的源（任何提供这种 JSON 的网址）。
            </p>
            <div className="mt-2 space-y-1">
              {sources.map((s) => {
                const entry = packCache[s.url];
                const isDefault = DEFAULT_MARKET_SOURCES.some((d) => d.url === s.url);
                return (
                  <div
                    key={s.url}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-2.5 py-1.5",
                      marketUrl === s.url ? "border-[#8B5CF6] bg-[#8B5CF6]/5" : "border-black/10 bg-white",
                    )}
                  >
                    <button onClick={() => setMarketUrl(s.url)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-[11px] font-medium text-[#303030]">
                        {s.name}
                        {isDefault && <span className="ml-1.5 rounded bg-muted px-1.5 py-px text-[10px] font-normal text-muted-foreground">默认</span>}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {entry
                          ? "缓存 " + new Date(entry.fetchedAt).toLocaleString() + " · " + entry.pack.characters.length + " 个角色"
                          : s.url}
                      </p>
                    </button>
                    <button
                      onClick={() => void refreshMarket(s.url)}
                      disabled={marketBusy}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {marketBusy && marketUrl === s.url ? "拉取中…" : "拉取"}
                    </button>
                    {!isDefault && (
                      <button
                        onClick={() => removeSource(s.url)}
                        title="删除该源"
                        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#EF4444]"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <input
                value={newSrc.name}
                onChange={(e) => setNewSrc((v) => ({ ...v, name: e.target.value }))}
                placeholder="源名称"
                className="w-24 rounded-md border border-border bg-white px-2 py-1 text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
              />
              <input
                value={newSrc.url}
                onChange={(e) => setNewSrc((v) => ({ ...v, url: e.target.value }))}
                placeholder="https://…/characters.json"
                className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 font-mono text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
              />
              <button
                onClick={addSource}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted hover:text-[#303030]"
              >
                添加
              </button>
            </div>
            {(() => {
              const entry = packCache[marketUrl];
              if (marketBusy) return <p className="mt-2 text-[11px] text-muted-foreground">拉取中…</p>;
              if (!entry)
                return <p className="mt-2 text-[11px] text-muted-foreground">该源还没有拉取过，点上方「拉取」获取角色包。</p>;
              return (
                <div className="mt-2 max-h-[36vh] space-y-2 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <p className="text-[10px] text-muted-foreground">
                    {entry.pack.name}
                    {entry.pack.updatedAt ? " · 更新于 " + entry.pack.updatedAt : ""}
                  </p>
                  {entry.pack.characters.map((c) => (
                    <CharacterCard
                      key={c.key}
                      c={c}
                      imported={importedIds.has(`tavern-${c.key}`)}
                      draft={editing[c.key] ?? c.persona}
                      expanded={editing[c.key] !== undefined}
                      onToggleExpand={() =>
                        setEditing((s) => {
                          const next = { ...s };
                          if (next[c.key] !== undefined) delete next[c.key];
                          else next[c.key] = c.persona;
                          return next;
                        })
                      }
                      onChangeDraft={(v) => setEditing((s) => ({ ...s, [c.key]: v }))}
                      onImport={() => importMember(c.key, c.name, editing[c.key] ?? c.persona, c.desc)}
                    />
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {tab === "presets" && (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              读取 dsh-tavern 插件的预设目录（每个预设 = 一份角色卡注入文本）。
              插件自带的空白基础预设（tavern-lite，无角色人设）已隐藏。
              <span className="ml-1 font-mono">{rootPath || "…"}</span>
            </p>
            {presets === null ? (
              <p className="mt-2 text-[11px] text-muted-foreground">读取中…</p>
            ) : visiblePresets.length === 0 ? (
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                未找到可用预设。可在官方 DSH「酒馆管理」导入角色卡后回来导入，或用「角色库 / 角色卡文件」导入。
              </p>
            ) : (
              <div className="mt-2 max-h-[46vh] space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {visiblePresets.map((p) => (
                  <div key={p.key} className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-semibold text-[#303030]">{p.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {p.persona ? "persona 已就绪 · " + p.persona.slice(0, 40) : "无 persona（导入后为通用角色扮演提示词）"}
                      </p>
                    </div>
                    <button
                      onClick={() => setWbEdit({ key: p.key, name: p.name })}
                      disabled={!rootPath}
                      title="编辑该预设的世界书（关键词/全文注入）"
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      世界书
                    </button>
                    <button
                      onClick={() => importPreset(p)}
                      className={cn(
                        "shrink-0 rounded-md px-2.5 py-1 text-[11px] text-white",
                        importedIds.has(`tavern-${p.key}`) ? "bg-[#10B981]" : "bg-[#8B5CF6] hover:bg-[#8B5CF6]/90",
                      )}
                    >
                      {mark(p.key)}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "file" && (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              导入 SillyTavern 格式的角色卡（PNG / JSON）。文件从哪来：SillyTavern 里导出的角色、
              角色分享社区/网站下载的卡，或照下面的最小结构自己写一份 JSON（字段都可以只填想要的）：
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded-md bg-black/5 p-2.5 font-mono text-[10px] leading-relaxed text-[#303030]">
              {`{
  "name": "角色名",
  "description": "人设描述（是谁、说话方式）",
  "personality": "性格",
  "scenario": "场景/世界观",
  "first_mes": "开场白"
}`}
            </pre>
            <button
              onClick={() => void pickCardFiles()}
              className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#8B5CF6]/40 py-2.5 text-xs text-[#464646] transition-colors hover:border-[#8B5CF6] hover:text-[#8B5CF6]"
            >
              <Upload className="h-4 w-4" />
              选择角色卡文件（PNG / JSON，可多选，默认打开主目录）
            </button>
            <p className="mt-1.5 text-center text-[10px] text-muted-foreground">
              也可以把 PNG / JSON 角色卡直接<b>拖进本窗口</b>任意位置导入
            </p>
          </div>
        )}

        {wbEdit && rootPath && (
          <WorldbookDialog
            presetKey={wbEdit.key}
            presetName={wbEdit.name}
            root={rootPath}
            onClose={() => setWbEdit(null)}
          />
        )}

        {note && <p className="mt-3 text-[11px] text-[#10B981]">{note}</p>}

        <div className="mt-4 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// AgentTeamPanel — 一个环境的完整团队管理
// ================================================================

export function AgentTeamPanel({ env }: { env: EnvProfile }) {
  const [list, setList] = useState<ConvItem[]>(() => loadAgentsOf(env.id));
  const refresh = useCallback(() => setList(loadAgentsOf(env.id)), [env.id]);
  useEffect(() => {
    setList(loadAgentsOf(env.id));
  }, [env.id]);

  const [agentModal, setAgentModal] = useState<null | { mode: "add" } | { mode: "edit"; agent: ConvItem }>(null);
  const [confirmDel, setConfirmDel] = useState<ConvItem | null>(null);
  const [tavernOpen, setTavernOpen] = useState(false);
  const teamImportRef = useRef<HTMLInputElement>(null);
  // 群聊
  const groups = useStore($groups);
  const [groupCreating, setGroupCreating] = useState(false);
  const [groupDraft, setGroupDraft] = useState<{ name: string; memberIds: string[]; mode: GroupMode }>({
    name: "",
    memberIds: [],
    mode: "all",
  });
  const isChat = env.id === TAVERN_MEMBER_ENV;

  const saveAgent = (data: {
    name: string;
    desc: string;
    avatarBg: string;
    systemPrompt?: string;
    model?: string;
    tools?: string[];
  }): void => {
    if (agentModal?.mode === "edit" && agentModal.agent) {
      updateAgentIn(env.id, agentModal.agent.id, {
        name: data.name,
        desc: data.desc,
        avatarBg: data.avatarBg,
        systemPrompt: data.systemPrompt,
        model: data.model,
        tools: data.tools,
      });
    } else {
      addAgentIn(env.id, {
        name: data.name,
        desc: data.desc,
        avatarBg: data.avatarBg,
        systemPrompt: data.systemPrompt,
        model: data.model,
        tools: data.tools,
      });
    }
    setAgentModal(null);
    refresh();
  };

  const exportTeam = async (): Promise<void> => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `mirach-agents-${env.id}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const data = { version: 1, env: env.id, exportedAt: Date.now(), members: loadAgentsOf(env.id) };
      await invoke("write_user_file", { path, content: JSON.stringify(data, null, 2) });
    } catch (e) {
      window.alert("导出失败：" + String(e));
    }
  };

  const importTeamFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { members?: ConvItem[] };
      if (!Array.isArray(data.members)) throw new Error("缺少 members 数组");
      const cur = loadAgentsOf(env.id);
      const ids = new Set(cur.map((a) => a.id));
      const merged = [...cur, ...data.members.filter((m) => m && m.id && !ids.has(m.id))];
      saveAgentsOf(env.id, merged);
      refresh();
    } catch (e) {
      window.alert("导入失败：" + String(e));
    }
  };

  return (
    <div className="pt-1">
      {/* 环境隐藏 = 团队整体不生效 */}
      {env.visible === false && (
        <p className="mb-2 rounded-md bg-[#F59E0B]/10 px-3 py-1.5 text-[11px] text-[#B45309]">
          该环境当前已隐藏（左栏不显示）——成员团队随之不生效；在环境卡片上打开「展示中」后恢复。
        </p>
      )}

      {/* 团队模板导入/导出 */}
      <div className="mb-2 flex items-center justify-end gap-1">
        <button
          onClick={() => void exportTeam()}
          title="导出该环境的团队为 JSON 文件"
          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          导出团队
        </button>
        <button
          onClick={() => teamImportRef.current?.click()}
          title="从 JSON 文件导入团队（成员按 id 合并，不覆盖已有）"
          className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
        >
          导入团队
        </button>
        <input
          ref={teamImportRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            void importTeamFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>

      {/* 聊天环境：原生酒馆面板置于智能体上方 */}
      {isChat && (
        <div className="mb-3">
          <NativeTavernPanel />
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {list.map((a) => (
          <div key={a.id} className="flex flex-col rounded-lg border border-black/10 bg-white p-3 shadow-sm transition-shadow hover:shadow-md">
            <div className="flex items-start gap-2.5">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                style={{ backgroundColor: a.avatarBg }}
              >
                {a.initials}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-[#303030]">{a.name}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">{a.desc}</p>
                <div className="mt-1 flex items-center gap-1.5">
                  <span
                    className={cn(
                      "status-pill",
                      a.status === "generating" && "!bg-[#F59E0B]/12 !text-[#B45309]",
                      a.status === "pending" && "!bg-muted !text-muted-foreground",
                    )}
                  >
                    <span className="dot" />
                    {a.status === "generating" ? "生成中" : a.status === "completed" ? "就绪" : "空闲"}
                  </span>
                  {a.source === "tavern" && (
                    <span className="rounded bg-[#8B5CF6]/10 px-1.5 py-px text-[10px] font-medium text-[#8B5CF6]">酒馆</span>
                  )}
                  <span className="truncate font-mono text-[10px] text-muted-foreground/60">{a.id}</span>
                </div>
                {(a.model || a.tools?.length) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {a.model && (
                      <span className="rounded bg-muted px-1.5 py-px text-[10px] font-mono text-muted-foreground">{a.model}</span>
                    )}
                    {a.tools?.map((tool) => (
                      <span key={tool} className="rounded border border-black/10 px-1.5 py-px text-[10px] text-muted-foreground">
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-end gap-1 border-t border-black/5 pt-2 opacity-0 transition-opacity hover:opacity-100">
              <button
                onClick={() => setAgentModal({ mode: "edit", agent: a })}
                title="编辑"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
              <button
                onClick={() => setConfirmDel(a)}
                title="删除"
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#EF4444]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}

        <button
          onClick={() => setAgentModal({ mode: "add" })}
          className="flex min-h-[120px] items-center justify-center gap-2 rounded-lg border border-dashed border-border text-[13px] text-muted-foreground transition-colors hover:border-[#6366F1]/50 hover:text-[#303030]"
        >
          <Plus className="h-4 w-4" />
          添加智能体
        </button>
      </div>

      {/* 酒馆角色接入（dsh-tavern）：仅聊天环境 */}
      {isChat && (
        <button
          onClick={() => setTavernOpen(true)}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#8B5CF6]/40 py-2 text-xs text-muted-foreground transition-colors hover:border-[#8B5CF6] hover:text-[#8B5CF6]"
        >
          <Users className="h-3.5 w-3.5" />
          导入酒馆角色（角色库 / 在线市场 / 预设 / 角色卡）
        </button>
      )}

      {/* 群聊（多成员同聊）：仅聊天环境 */}
      {isChat && (
        <div className="mt-3 rounded-lg border border-black/10 p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold text-[#303030]">群聊（多成员同聊）</p>
            <button
              onClick={() => setGroupCreating((v) => !v)}
              className="rounded-md border border-border px-2 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted"
            >
              {groupCreating ? "收起" : "新建群聊"}
            </button>
          </div>

          {groups.length > 0 && (
            <div className="mt-2 space-y-1">
              {groups.map((g) => {
                const agent = list.find((a) => a.id === g.id);
                if (!agent) return null; // 群聊伪成员已被删除
                const names = g.memberIds
                  .map((id) => list.find((a) => a.id === id)?.name)
                  .filter(Boolean)
                  .join("、");
                return (
                  <div key={g.id} className="flex items-center gap-2 rounded-md border border-black/5 bg-muted/30 px-2.5 py-1.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] font-medium text-[#303030]">{g.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {names || "未选成员"} · {g.mode === "all" ? "全员依次回复" : "轮流发言"}
                      </p>
                    </div>
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent("mirach:open-member", { detail: agent }))}
                      className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted hover:text-[#303030]"
                    >
                      打开
                    </button>
                    <button
                      onClick={() => {
                        removeGroup(g.id);
                        removeAgentIn(env.id, g.id);
                        refresh();
                      }}
                      title="删除群聊"
                      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#EF4444]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {groupCreating && (
            <div className="mt-2 rounded-md border border-border p-2">
              <input
                value={groupDraft.name}
                onChange={(e) => setGroupDraft((v) => ({ ...v, name: e.target.value }))}
                placeholder="群聊名称"
                className="w-full rounded-md border border-border bg-white px-2 py-1 text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
              />
              <p className="mt-1.5 text-[10px] text-muted-foreground">选择参与者：</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {list
                  .filter((a) => !a.id.startsWith("grp-"))
                  .map((a) => {
                    const on = groupDraft.memberIds.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        onClick={() =>
                          setGroupDraft((v) => ({
                            ...v,
                            memberIds: on ? v.memberIds.filter((x) => x !== a.id) : [...v.memberIds, a.id],
                          }))
                        }
                        className={cn(
                          "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                          on ? "border-[#0EA5E9] bg-[#0EA5E9]/10 text-[#0EA5E9]" : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {a.name}
                      </button>
                    );
                  })}
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <select
                  value={groupDraft.mode}
                  onChange={(e) => setGroupDraft((v) => ({ ...v, mode: e.target.value as GroupMode }))}
                  className="rounded-md border border-border bg-white px-2 py-1 text-[11px] text-[#303030] outline-none focus:border-[#8B5CF6]"
                >
                  <option value="all">全员依次回复</option>
                  <option value="round">轮流发言（每次一人）</option>
                </select>
                <button
                  onClick={() => {
                    if (!groupDraft.name.trim() || groupDraft.memberIds.length === 0) return;
                    const agent = addAgentIn(env.id, {
                      name: "群聊 · " + groupDraft.name.trim(),
                      desc: `${groupDraft.memberIds.length} 位成员群聊`,
                      avatarBg: "#0EA5E9",
                    });
                    createGroup(groupDraft.name.trim(), groupDraft.memberIds, groupDraft.mode, agent.id);
                    setGroupDraft({ name: "", memberIds: [], mode: "all" });
                    setGroupCreating(false);
                    refresh();
                  }}
                  disabled={!groupDraft.name.trim() || groupDraft.memberIds.length === 0}
                  className="ml-auto rounded-md bg-[#0EA5E9] px-2.5 py-1 text-[11px] text-white transition-colors hover:bg-[#0EA5E9]/90 disabled:opacity-50"
                >
                  创建群聊
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {agentModal && (
        <AgentEditModal
          agent={agentModal.mode === "edit" ? agentModal.agent : null}
          onClose={() => setAgentModal(null)}
          onSave={saveAgent}
        />
      )}

      {tavernOpen && <TavernImportDialog onClose={() => setTavernOpen(false)} onImported={refresh} />}

      <ConfirmDialog
        open={confirmDel !== null}
        title="删除智能体"
        description={"确定删除「" + (confirmDel?.name ?? "") + "」吗？其会话记录将保留。"}
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmDel) {
            if (confirmDel.id.startsWith("grp-")) removeGroup(confirmDel.id); // 群聊定义一并清理
            removeAgentIn(env.id, confirmDel.id);
          }
          setConfirmDel(null);
          refresh();
        }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ================================================================
// AgentEditModal — 智能体添加 / 编辑弹窗（名称 + 简介 + 头像色 + 系统提示词 + 模型 + 工具）
// ================================================================

function AgentEditModal({
  agent,
  onClose,
  onSave,
}: {
  agent: ConvItem | null;
  onClose: () => void;
  onSave: (data: {
    name: string;
    desc: string;
    avatarBg: string;
    systemPrompt?: string;
    model?: string;
    tools?: string[];
  }) => void;
}) {
  const providerConfigs = useStore($providerConfig);
  const [name, setName] = useState(agent?.name ?? "");
  const [desc, setDesc] = useState(agent?.desc ?? "");
  const [color, setColor] = useState(agent?.avatarBg ?? "#6366F1");
  const [systemPrompt, setSystemPrompt] = useState(agent?.systemPrompt ?? "");
  const [model, setModel] = useState(agent?.model ?? "");
  const [tools, setTools] = useState<string[]>(agent?.tools ?? []);
  const COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];
  const TOOL_OPTIONS = ["bash", "文件", "搜索", "浏览器", "网络", "代码"];
  // 全部可用模型（来自已配置的提供商）
  const modelOptions = providerConfigs.flatMap((c) => c.models.map((m) => ({ id: m.id, provider: c.name })));
  const canSave = name.trim().length > 0;

  const submit = () =>
    canSave &&
    onSave({
      name,
      desc,
      avatarBg: color,
      systemPrompt: systemPrompt.trim() || undefined,
      model: model || undefined,
      tools: tools.length ? tools : undefined,
    });

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="max-h-[85vh] w-[440px] overflow-y-auto rounded-xl bg-white p-4 shadow-2xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-[#303030]">{agent ? "编辑智能体" : "添加智能体"}</h3>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] text-muted-foreground">名称</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="智能体名称"
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-[13px] text-[#303030] outline-none transition-colors focus:border-[#6366F1]"
          />
        </label>
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-muted-foreground">简介 / 职责</span>
          <input
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="如：前端工程师 · 负责界面布局"
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-[12px] text-[#303030] outline-none transition-colors focus:border-[#6366F1]"
          />
        </label>

        {/* 系统提示词（persona） */}
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-muted-foreground">系统提示词（persona）</span>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            placeholder="你是… 负责… 例如：你是前端工程师，负责界面布局与组件开发，输出前先分析需求。"
            className="w-full resize-none rounded-md border border-border bg-white px-3 py-2 text-[12px] leading-relaxed text-[#303030] outline-none transition-colors focus:border-[#6366F1]"
          />
        </label>

        {/* 头像色 */}
        <div className="mt-2">
          <span className="mb-1 block text-[11px] text-muted-foreground">头像颜色</span>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={cn(
                  "h-6 w-6 rounded-full border-2 transition-colors",
                  color === c ? "border-[#303030]" : "border-transparent",
                )}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>

        {/* 模型选择 */}
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-muted-foreground">使用模型</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-border bg-white px-2 py-1 text-[12px] text-[#303030] outline-none transition-colors focus:border-[#6366F1]"
          >
            <option value="">（默认）</option>
            {modelOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} · {m.provider}
              </option>
            ))}
          </select>
        </label>

        {/* 工具清单 */}
        <div className="mt-2">
          <span className="mb-1 block text-[11px] text-muted-foreground">可用工具</span>
          <div className="flex flex-wrap gap-1.5">
            {TOOL_OPTIONS.map((tool) => {
              const checked = tools.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => setTools((prev) => (checked ? prev.filter((x) => x !== tool) : [...prev, tool]))}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    checked
                      ? "border-[#6366F1]/50 bg-[#6366F1]/10 text-[#6366F1]"
                      : "border-border text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tool}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            取消
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="rounded-md bg-[#017CF3] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#017CF3]/90 disabled:opacity-50"
          >
            {agent ? "保存" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}
