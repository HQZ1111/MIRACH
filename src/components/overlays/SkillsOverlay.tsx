/**
 * SkillsOverlay — 技能与工具面板（按原型 Skills & Tools 精确复刻）
 *
 * 顶部 Tab：Skills / Tools / MCP / Browse Hub / Webhook / Plugins / Agents
 *（Webhook / Plugins / Agents 为用户追加；Agents 内嵌代理派生树，复用 AgentsTreeContent）
 * - Skills：排序（Most used/Least used）+ 全开/禁用未用 + 行（名称/分类/来源 badge/usage ×N/开关）
 * - Tools：行（label/描述/调用数或 N tools/开关）+ 详情（工具 chip）
 * - MCP：Servers/Catalog + 服务器行（状态点/能力摘要/Reload/Remove）
 * - Hub：Connected hubs + {t("skills.featuredSkills")} + 技能卡（信任 badge/Preview/Install）
 * - Webhook：订阅列表 + 详情 + {t("skills.newSubscription")}
 * - Plugins：插件列表（类型 pill/开关）
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { invoke } from "@tauri-apps/api/core";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { $activeSessionId } from "@/store/session";
import { $toolCalls } from "@/store/tool-calls";
import {
  Puzzle,
  Search,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

interface TabDef {
  id: string;
  label: string;
  icon: LucideIcon;
  meta?: number;
}

const TABS: TabDef[] = [
  { id: "skills", label: "skills", icon: Puzzle, meta: -1 },
  { id: "tools", label: "tools", icon: Wrench, meta: -2 },
];

interface Skill {
  name: string;
  category: string;
  provenance?: "agent" | "hub" | "bundled";
  usage: number;
  enabled: boolean;
  desc: string;
}

/** 引擎未返回技能时的占位（保持详情面板形状；引导真实接入路径） */
const EMPTY_SKILL: Skill = {
  name: "",
  category: "",
  usage: 0,
  enabled: false,
  desc: "引擎尚未发现技能。把技能目录放到 ~/.dsh/skills（或项目 .dsh/skills）后重启应用即可生效。",
};

export function SkillsOverlay() {
  const { t } = useI18n();
  const [tab, setTab] = useState("skills");
  const [search, setSearch] = useState("");
  // 技能数据 = 引擎 skill.list RPC（skill-filesystem 扫描 ~/.dsh/skills 等），
  // 拉取失败/为空显示真实空态——不再渲染硬编码演示清单
  const [skills, setSkills] = useState<Skill[]>([]);
  const [skillsErr, setSkillsErr] = useState<string | null>(null);
  const [sortDesc, setSortDesc] = useState(true);
  // 详情区当前选中技能 + 归档确认（learning：归档可随时用 `hermes curator restore` 恢复）
  const [selectedSkill, setSelectedSkill] = useState<Skill>(EMPTY_SKILL);
  const [confirmArchive, setConfirmArchive] = useState<Skill | null>(null);
  // 工具面板：本会话真实工具调用聚合（$toolCalls）
  const toolCalls = useStore($toolCalls);
  // 技能真化：经 dsh_rpc 调引擎 skill.list（需 runtime 启用 skill-filesystem）
  useEffect(() => {
    let alive = true;
    void invoke<{ skills?: { name?: string; description?: string; whenToUse?: string; modelInvocable?: boolean }[] }>(
      "dsh_rpc",
      { method: "skill.list", params: { sessionId: $activeSessionId.get() ?? undefined } },
    )
      .then((r) => {
        if (!alive) return;
        const list = (r?.skills ?? [])
          .filter((x) => x.name)
          .map<Skill>((sk) => ({
            name: sk.name!,
            category: sk.modelInvocable === false ? "session" : "invocable",
            provenance: undefined,
            usage: 0,
            enabled: true,
            desc: sk.description || sk.whenToUse || "",
          }));
        setSkills(list);
        setSelectedSkill(list[0] ?? EMPTY_SKILL);
      })
      .catch((e) => {
        if (!alive) return;
        setSkillsErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, []);
  const sortedSkills = [...skills]
    .filter((s) => !search || s.name.includes(search.toLowerCase()) || s.category.includes(search.toLowerCase()))
    .sort((a, b) => (sortDesc ? b.usage - a.usage : a.usage - b.usage));

  return (
    <div className="relative flex h-full flex-col">
      {/* 顶部 Tab + 搜索 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.id}
            onClick={() => setTab(tabDef.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-body-sm transition-colors",
              tab === tabDef.id ? "bg-muted font-medium text-[#303030]" : "text-[#464646] hover:bg-muted/60",
            )}
          >
            <tabDef.icon className="h-4 w-4" strokeWidth={2} />
            <span>{t(`skills.${tabDef.label}`)}</span>
            {tabDef.id === "skills" && (
              <span className="rounded-full bg-black/5 px-1.5 text-[10px] tabular-nums text-muted-foreground">{skills.length}</span>
            )}
            {tabDef.id === "tools" && toolCalls.length > 0 && (
              <span className="rounded-full bg-black/5 px-1.5 text-[10px] tabular-nums text-muted-foreground">{toolCalls.length}</span>
            )}
          </button>
        ))}
        {(tab === "skills" || tab === "tools") && (
          <div className="relative ml-auto w-48">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "skills" ? t("skills.searchSkills") : tab === "tools" ? t("skills.searchTools") : tab === "hub" ? t("skills.searchHub") : "Search..."}
              className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
            />
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
        )}
      </div>

      {/* 内容区 */}
      <div className="min-h-0 flex-1">
        {tab === "skills" && (
          <div className="flex h-full">
            <div className="flex w-72 shrink-0 flex-col border-r border-border">
              {/* 排序 + kebab */}
              <div className="flex h-6 items-center justify-between border-b border-border/60 px-2">
                <button
                  onClick={() => setSortDesc((v) => !v)}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-[#303030]"
                >
                  {sortDesc ? t("skills.mostUsed") : t("skills.leastUsed")}
                </button>
                <div className="relative">
                  <button className="text-[11px] text-muted-foreground transition-colors hover:text-[#303030]">⋯</button>
                  <div className="absolute right-0 top-full z-10 mt-0.5 hidden w-36 rounded-md border border-border bg-white py-1 shadow-md group-hover:block">
                    <button
                      className="flex w-full items-center justify-between px-2.5 py-1 text-[11px] text-[#303030] hover:bg-muted"
                      onClick={() => {
                        const all = skills.every((x) => x.enabled);
                        setSkills((list) => list.map((x) => ({ ...x, enabled: !all })));
                      }}
                    >
                      {t("skills.all")} <SwitchButton on={skills.every((x) => x.enabled)} onChange={() => {}} />
                    </button>
                    <button
                      className="block w-full px-2.5 py-1 text-left text-[11px] text-[#303030] hover:bg-muted"
                      onClick={() => setSkills((list) => list.map((x) => ({ ...x, enabled: x.usage > 0 })))}
                    >
                      {t("skills.disableUnused")}
                    </button>
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {skillsErr && (
                  <p className="px-2 py-3 text-[11px] text-[#EF4444]">引擎技能列表获取失败：{skillsErr}</p>
                )}
                {!skillsErr && sortedSkills.length === 0 && (
                  <div className="px-2 py-6 text-center text-[11px] leading-relaxed text-muted-foreground">
                    引擎尚未发现技能。
                    <br />
                    把技能目录放到 <code>~/.dsh/skills</code>（或项目 <code>.dsh/skills</code>），
                    重启应用后经 skill.list 加载。
                  </div>
                )}
                {sortedSkills.map((s) => (
                  <div
                    key={s.name}
                    onClick={() => setSelectedSkill(s)}
                    className={cn(
                      "flex cursor-pointer items-center gap-2 px-2 py-2 transition-colors hover:bg-muted/60",
                      selectedSkill.name === s.name && "bg-muted/80",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn("block truncate text-body-sm", s.enabled ? "font-medium text-[#303030]" : "text-muted-foreground")}>
                        {s.name}
                      </span>
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        {t(`skills.${s.category}`)}
                        {s.provenance === "agent" && (
                          <span className="rounded-full bg-[#303030] px-1.5 py-px text-[9px] uppercase text-white">{t("skills.learned")}</span>
                        )}
                        {s.provenance === "hub" && (
                          <span className="rounded-full bg-muted px-1.5 py-px text-[9px] uppercase text-muted-foreground">{t("skills.hubBadge")}</span>
                        )}
                      </span>
                    </span>
                    {s.usage > 0 && (
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">×{s.usage}</span>
                    )}
                    <SwitchButton on={s.enabled} onChange={(v) => setSkills((list) => list.map((x) => (x.name === s.name ? { ...x, enabled: v } : x)))} />
                  </div>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <div className="flex items-center gap-2">
                <h3 className="text-member font-bold text-[#303030]">{selectedSkill.name}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t(`skills.${selectedSkill.category}`)}</span>
                {selectedSkill.provenance === "agent" && (
                  <span className="rounded-full bg-[#303030] px-2 py-0.5 text-[11px] text-white">{t("skills.learned")}</span>
                )}
                {selectedSkill.provenance === "hub" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("skills.hubBadge")}</span>
                )}
                {selectedSkill.provenance === "bundled" && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{t("skills.builtinBadge")}</span>
                )}
                {selectedSkill.usage > 0 && (
                  <span className="rounded-full bg-black/5 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">×{selectedSkill.usage}</span>
                )}
              </div>
              <p className="mt-3 text-body-sm leading-relaxed text-muted-foreground">{selectedSkill.desc}</p>
              <div className="mt-4 rounded-lg border border-border bg-muted/20 p-3 font-mono text-[11px] leading-relaxed text-[#303030]">
                # Usage example
                {"\n"}# invoke {selectedSkill.name}
                {"\n"}{"> "}{selectedSkill.name} —— 用一句话描述任务即可调用
              </div>
              <div className="mt-4 flex gap-2">
                <button className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#464646]">{t("skills.edit")}</button>
                <button
                  onClick={() => setConfirmArchive(selectedSkill)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted hover:text-[#EF4444]"
                >
                  {t("skills.archive")}
                </button>
              </div>
              <p className="mt-4 text-[11px] text-muted-foreground">{t("skills.changesApplyNew")}</p>
            </div>
          </div>
        )}

        {/* MCP / Hub / Webhook / Plugins / Agents tabs removed with the demo data;
             they will come back with real engine-backed data only. */}

      </div>

      {/* ---- 归档确认（learning：归档后可随时用 hermes curator restore 恢复） ---- */}
      {confirmArchive && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={() => setConfirmArchive(null)}>
          <div
            className="panel-glass popup-anim relative w-[380px] rounded-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="flex items-center gap-2 text-body-sm font-bold text-[#303030]">
              <Trash2 className="h-4 w-4 text-[#EF4444]" strokeWidth={2} />
              归档技能「{confirmArchive.name}」
            </h3>
            <p className="mt-3 text-body-sm leading-relaxed text-muted-foreground">
              该技能将从技能列表中移除（对应学习节点一并归档），之后可用{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-[#303030]">hermes curator restore</code>{" "}
              恢复。已生成的技能元数据不会被删除。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmArchive(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setSkills((list) => list.filter((x) => x.name !== confirmArchive.name));
                  setSelectedSkill((cur) => (cur.name === confirmArchive.name ? EMPTY_SKILL : cur));
                  setConfirmArchive(null);
                }}
                className="rounded-md bg-[#EF4444] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#DC2626]"
              >
                归档
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
