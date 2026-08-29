/**
 * ProfilesOverlay — 档案页（对齐原型 Profiles）
 *
 * master-detail：左侧档案列表（彩色首字母头像、默认徽章、.env pill、路径、模型/提供方、技能数、描述），
 * 右侧详情：SOUL.md 编辑（未保存标记 + 保存）、新建（克隆自下拉）/重命名/删除确认、
 * 设为活跃 / 改模型（提供方·模型下拉）/ 编辑描述，以及 Build 5 步构建向导（ProfileBuilderWizard）。
 * 数据为本地 state（后续可接引擎 profiles API）。
 */

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import {
  CaretDown,
  Check,
  Copy,
  House,
  PencilSimple,
  Plus,
  SquaresFour,
  Trash,
} from "@phosphor-icons/react";
import {
  ProfileBuilderWizard,
  MODEL_OPTIONS,
  type ProfileBuilderResult,
} from "@/components/overlays/ProfileBuilderWizard";

interface ProfileItem {
  id: string;
  name: string;
  isDefault: boolean;
  path: string;
  model: string;
  provider: string;
  skillCount: number;
  color: string;
  soul: string;
  description: string;
  skills?: string[];
  mcpServers?: string[];
}

// 模型选项：改模型下拉与 Build 向导共用
const PROVIDERS = [...new Set(MODEL_OPTIONS.map((m) => m.provider))];
const modelsForProvider = (provider: string) =>
  MODEL_OPTIONS.filter((m) => m.provider === provider).map((m) => m.model);

// 头像底色池（按名字哈希取色）
const AVATAR_COLORS = ["#6366F1", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#0EA5E9"];

// 种子档案 = 6 模式，id/颜色对齐 LeftSidebar viewConfigs（工具栏图标）：
// hermes 主环境（logo，在 .myhermes 根）+ chat/code/work/finance/write 档案（.myhermes/profiles/<id>）
const SEED: ProfileItem[] = [
  {
    id: "mirach",
    name: "Mirach",
    isDefault: true,
    path: "C:\\Users\\Administrator\\.myhermes",
    model: "gpt-4o",
    provider: "OpenAI",
    skillCount: 24,
    color: "#303030",
    description: "主环境（logo）：全能个人助理，六模式之根",
    soul: `# Mirach Agent Persona（主环境 · Mirach）

你是 **Mirach**，一个由 Nous Research 创造的全能个人助理。你乐于助人、知识广博、直接高效。

职责范围：
- 回答问题、写作与编辑代码、信息分析、创意工作
- 通过工具执行实际操作（文件、终端、浏览器等）
- 沟通清晰，不确定时坦诚说明
- 优先做到真正有用，而非冗长

这是本环境的**主环境档案**（点击 logo 进入）。其他模式档案见 \`profiles/\` 目录。

<!-- 编辑此文件以定制 Mirach 的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
  {
    id: "chat",
    name: "Chat Mirach",
    isDefault: false,
    path: "C:\\Users\\Administrator\\.myhermes\\profiles\\chat",
    model: "glm-5p2",
    provider: "Z.AI",
    skillCount: 12,
    color: "#6366F1",
    description: "智能对话 · 实时翻译 · 情感分析",
    soul: `# Mirach Agent Persona（Chat Mirach · 对话模式）

你是 **Chat Mirach**，Mirach 的对话聊天助手。你擅长：
- 日常对话、闲聊、答疑解惑
- 信息整理、要点归纳、观点交流
- 语气亲切自然，善解人意

<!-- 编辑此文件以定制本模式的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
  {
    id: "code",
    name: "Code Mirach",
    isDefault: false,
    path: "C:\\Users\\Administrator\\.myhermes\\profiles\\code",
    model: "gpt-4o",
    provider: "OpenAI",
    skillCount: 18,
    color: "#F59E0B",
    description: "代码生成 · 审查 · 重构 · 调试",
    soul: `# Mirach Agent Persona（Code Mirach · 编程模式）

你是 **Code Mirach**，Mirach 的编程助手。你擅长：
- 阅读、编写、重构、调试代码
- 技术方案设计、架构评审
- 写代码前先理解上下文，代码风格贴合现有代码

<!-- 编辑此文件以定制本模式的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
  {
    id: "work",
    name: "Work Mirach",
    isDefault: false,
    path: "C:\\Users\\Administrator\\.myhermes\\profiles\\work",
    model: "glm-5p2",
    provider: "Z.AI",
    skillCount: 10,
    color: "#10B981",
    description: "任务管理 · 日程安排 · 文档处理",
    soul: `# Mirach Agent Persona（Work Mirach · 工作模式）

你是 **Work Mirach**，Mirach 的工作助手。你擅长：
- 办公事务：文档、表格、演示、邮件
- 任务排程、项目管理、会议纪要
- 高效、条理清晰、执行力强

<!-- 编辑此文件以定制本模式的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
  {
    id: "finance",
    name: "Finance Mirach",
    isDefault: false,
    path: "C:\\Users\\Administrator\\.myhermes\\profiles\\finance",
    model: "kimi-k2p6",
    provider: "Moonshot",
    skillCount: 9,
    color: "#EF4444",
    description: "数据分析 · 风险评估 · 市场预测",
    soul: `# Mirach Agent Persona（Finance Mirach · 金融模式）

你是 **Finance Mirach**，Mirach 的金融助手。你擅长：
- 财务分析、投资研究、市场数据解读
- 风险提示、审慎客观
- 涉及投资建议时明确声明信息仅供参考，不构成投资建议

<!-- 编辑此文件以定制本模式的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
  {
    id: "write",
    name: "Write Mirach",
    isDefault: false,
    path: "C:\\Users\\Administrator\\.myhermes\\profiles\\write",
    model: "glm-5p2",
    provider: "Z.AI",
    skillCount: 12,
    color: "#8B5CF6",
    description: "文案创作 · 内容优化 · 多语翻译",
    soul: `# Mirach Agent Persona（Write Mirach · 写作模式）

你是 **Write Mirach**，Mirach 的写作助手。你擅长：
- 文章、文案、故事、脚本创作
- 润色改写、风格模仿、结构组织
- 文字细腻、表达准确、忠实于用户的意图

<!-- 编辑此文件以定制本模式的个性与语气。此文件每条消息都会被重新加载，无需重启。
     清空内容（或删除本文件）将回退到默认个性。 -->`,
  },
];

function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function ProfilesOverlay({ onClose }: { onClose: () => void }) {
  const [profiles, setProfiles] = useState<ProfileItem[]>(SEED);
  const [selectedId, setSelectedId] = useState(SEED[0].id);
  const [soulDraft, setSoulDraft] = useState(SEED[0].soul);
  const [savedId, setSavedId] = useState<string | null>(null);
  // 新建/重命名内联输入
  const [creating, setCreating] = useState(false);
  const [cloneFrom, setCloneFrom] = useState(SEED[0].id);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // 改模型 / 编辑描述
  const [editingModel, setEditingModel] = useState(false);
  const [providerDraft, setProviderDraft] = useState(SEED[0].provider);
  const [modelDraft, setModelDraft] = useState(SEED[0].model);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(SEED[0].description);
  // Build 向导
  const [showBuilder, setShowBuilder] = useState(false);

  const selected = useMemo(
    () => profiles.find((p) => p.id === selectedId) ?? profiles[0],
    [profiles, selectedId],
  );

  const dirty = soulDraft !== selected.soul;

  const selectProfile = (p: ProfileItem) => {
    setSelectedId(p.id);
    setSoulDraft(p.soul);
    setSavedId(null);
    setEditingModel(false);
    setEditingDesc(false);
    setProviderDraft(p.provider);
    setModelDraft(p.model);
    setDescDraft(p.description);
  };

  const saveSoul = () => {
    setProfiles((ps) => ps.map((p) => (p.id === selected.id ? { ...p, soul: soulDraft } : p)));
    setSavedId(selected.id);
    window.setTimeout(() => setSavedId(null), 1200);
  };

  const setActiveProfile = () => {
    setProfiles((ps) => ps.map((p) => ({ ...p, isDefault: p.id === selected.id })));
  };

  const startEditModel = () => {
    setProviderDraft(selected.provider);
    setModelDraft(selected.model);
    setEditingModel(true);
  };

  const saveModel = () => {
    if (!selected) return;
    setProfiles((ps) =>
      ps.map((p) => (p.id === selected.id ? { ...p, provider: providerDraft, model: modelDraft } : p)),
    );
    setEditingModel(false);
  };

  const startEditDesc = () => {
    setDescDraft(selected.description);
    setEditingDesc(true);
  };

  const saveDesc = () => {
    if (!selected) return;
    setProfiles((ps) =>
      ps.map((p) => (p.id === selected.id ? { ...p, description: descDraft.trim() } : p)),
    );
    setEditingDesc(false);
  };

  const handleBuilderCreate = (r: ProfileBuilderResult) => {
    const base = profiles.find((p) => p.id === cloneFrom);
    const item: ProfileItem = {
      id: `p${Date.now()}`,
      name: r.name,
      isDefault: false,
      path: `C:\\Users\\Administrator\\.myhermes\\profiles\\${r.name}`,
      model: r.model,
      provider: r.provider,
      skillCount: r.skills.length,
      color: avatarColor(r.name),
      soul: base ? base.soul : `# ${r.name} 的 SOUL.md\n\n${r.description}\n`,
      description: r.description,
      skills: r.skills,
      mcpServers: r.mcpServers,
    };
    setProfiles((ps) => [...ps, item]);
    setShowBuilder(false);
    selectProfile(item);
  };

  const createProfile = () => {
    const name = newName.trim() || "新档案";
    const base = profiles.find((p) => p.id === cloneFrom);
    const item: ProfileItem = {
      id: `p${Date.now()}`,
      name,
      isDefault: false,
      path: `C:\\Users\\Administrator\\.myhermes\\profiles\\${name}`,
      model: base?.model ?? "gpt-4o",
      provider: base?.provider ?? "OpenAI",
      skillCount: base?.skillCount ?? 0,
      color: avatarColor(name),
      soul: base ? base.soul : `# ${name} 的 SOUL.md\n\n新建档案。\n`,
      description: base?.description ?? "",
    };
    setProfiles((ps) => [...ps, item]);
    setCreating(false);
    setNewName("");
    selectProfile(item);
  };

  const renameProfile = () => {
    const name = renameName.trim();
    if (!name || !renamingId) return;
    setProfiles((ps) =>
      ps.map((p) =>
        p.id === renamingId
          ? { ...p, name, path: `C:\\Users\\Administrator\\.myhermes\\profiles\\${name}` }
          : p,
      ),
    );
    setRenamingId(null);
  };

  const deleteProfile = () => {
    if (!deletingId) return;
    setProfiles((ps) => ps.filter((p) => p.id !== deletingId));
    if (selectedId === deletingId) {
      const rest = profiles.filter((p) => p.id !== deletingId);
      if (rest.length > 0) selectProfile(rest[0]);
      else setSelectedId("");
    }
    setDeletingId(null);
  };

  const copyPath = (path: string) => {
    void navigator.clipboard?.writeText(path).catch(() => {});
  };

  return (
    <OverlayShell title="档案" onClose={onClose} width={1040} height={720}>
      <div className="flex h-full">
        {/* ---- 左侧列表列 ---- */}
        <div className="flex w-72 shrink-0 flex-col border-r border-border">
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            <button
              onClick={() => setCreating((v) => !v)}
              className="flex flex-1 items-center justify-center gap-1 rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-colors hover:bg-foreground/90"
            >
              <Plus size={14} weight="bold" />
              新建档案
            </button>
            {/* Build 构建向导 */}
            <button
              onClick={() => setShowBuilder(true)}
              title="Build 构建向导"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#303030] text-white transition-colors hover:bg-[#464646]"
            >
              <SquaresFour size={13} weight="bold" />
            </button>
            {/* 克隆自（新建时生效） */}
            <div className="relative">
              <select
                value={cloneFrom}
                onChange={(e) => setCloneFrom(e.target.value)}
                title="克隆自"
                className="h-7 w-20 cursor-pointer appearance-none rounded-md border border-border bg-white px-2 text-xs text-[#464646] outline-none"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <CaretDown
                size={12}
                weight="bold"
                className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </div>

          {/* 新建内联输入 */}
          {creating && (
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProfile()}
                placeholder="档案名称…"
                className="min-w-0 flex-1 rounded-md border border-border px-2 py-1 text-xs text-[#303030] outline-none placeholder:text-muted-foreground"
              />
              <button
                onClick={createProfile}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-foreground text-background"
                title="创建"
              >
                <Check size={13} weight="bold" />
              </button>
            </div>
          )}

          {/* 档案列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {profiles.map((p) => (
              <button
                key={p.id}
                onClick={() => selectProfile(p)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors",
                  p.id === selectedId ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {p.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-body-sm font-medium text-[#303030]">{p.name}</span>
                    {p.isDefault && (
                      <span className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                        <House size={10} weight="fill" />
                        默认
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">{p.model}</span>
                    <span>·</span>
                    <span>{p.skillCount} 技能</span>
                  </span>
                  {p.description && (
                    <span className="mt-0.5 block truncate text-[11px] text-muted-foreground/80">
                      {p.description}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {profiles.length === 0 && (
              <p className="px-4 py-8 text-center text-body-sm text-muted-foreground">
                暂无档案，点击右上角"新建档案"创建
              </p>
            )}
          </div>
        </div>

        {/* ---- 右侧详情列 ---- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {selected ? (
            <>
              {/* 详情头：名字 + 元信息 + 操作 */}
              <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                  style={{ backgroundColor: selected.color }}
                >
                  {selected.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {renamingId === selected.id ? (
                      <input
                        autoFocus
                        value={renameName}
                        onChange={(e) => setRenameName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && renameProfile()}
                        className="w-40 rounded-md border border-border px-2 py-0.5 text-sm text-[#303030] outline-none"
                      />
                    ) : (
                      <span className="text-body-sm font-bold text-[#303030]">{selected.name}</span>
                    )}
                    {selected.isDefault && (
                      <span className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <House size={10} weight="fill" />
                        默认
                      </span>
                    )}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      .env
                    </span>
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <span className="truncate">{selected.path}</span>
                    <Copy
                      size={11}
                      weight="bold"
                      className="shrink-0 cursor-pointer hover:text-[#303030]"
                      onClick={() => copyPath(selected.path)}
                    />
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {!selected.isDefault && (
                    <button
                      onClick={setActiveProfile}
                      title="设为活跃"
                      className="rounded-md border border-border px-2 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
                    >
                      设为活跃
                    </button>
                  )}
                  {renamingId === selected.id ? (
                    <button
                      onClick={renameProfile}
                      className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background"
                    >
                      确定
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        setRenamingId(selected.id);
                        setRenameName(selected.name);
                      }}
                      title="重命名"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
                    >
                      <PencilSimple size={15} weight="bold" />
                    </button>
                  )}
                  {deletingId === selected.id ? (
                    <span className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                      <span className="text-muted-foreground">确认删除？</span>
                      <button onClick={deleteProfile} className="font-medium text-[#EF4444]">
                        删除
                      </button>
                      <button
                        onClick={() => setDeletingId(null)}
                        className="text-muted-foreground hover:text-[#303030]"
                      >
                        取消
                      </button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setDeletingId(selected.id)}
                      title="删除"
                      disabled={selected.isDefault}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash size={15} weight="bold" />
                    </button>
                  )}
                </div>
              </div>

              {/* 元信息行：模型 / 提供方 / 技能数（可编辑） */}
              <div className="flex shrink-0 items-center gap-4 border-b border-border px-5 py-2 text-[11px] text-muted-foreground">
                {editingModel ? (
                  <>
                    <span className="flex items-center gap-1.5">
                      提供方
                      <select
                        value={providerDraft}
                        onChange={(e) => {
                          const p = e.target.value;
                          setProviderDraft(p);
                          setModelDraft(MODEL_OPTIONS.find((m) => m.provider === p)?.model ?? modelDraft);
                        }}
                        className="h-6 cursor-pointer rounded-md border border-border bg-white px-1.5 text-[11px] text-[#303030] outline-none"
                      >
                        {PROVIDERS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </span>
                    <span className="flex items-center gap-1.5">
                      模型
                      <select
                        value={modelDraft}
                        onChange={(e) => setModelDraft(e.target.value)}
                        className="h-6 cursor-pointer rounded-md border border-border bg-white px-1.5 text-[11px] text-[#303030] outline-none"
                      >
                        {modelsForProvider(providerDraft).map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </span>
                    <button
                      onClick={saveModel}
                      className="rounded-md bg-foreground px-2 py-0.5 text-[11px] text-background"
                    >
                      保存
                    </button>
                    <button onClick={() => setEditingModel(false)} className="hover:text-[#303030]">
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <span>
                      模型：<span className="text-[#303030]">{selected.model}</span>
                    </span>
                    <span>
                      提供方：<span className="text-[#303030]">{selected.provider}</span>
                    </span>
                    <span>
                      技能：<span className="text-[#303030]">{selected.skillCount} 个</span>
                    </span>
                    <button
                      onClick={startEditModel}
                      className="ml-auto rounded-md border border-border px-2 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                    >
                      更改
                    </button>
                  </>
                )}
              </div>

              {/* 描述（可编辑） */}
              <div className="flex shrink-0 items-start gap-2 border-b border-border px-5 py-2">
                {editingDesc ? (
                  <>
                    <textarea
                      autoFocus
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      rows={2}
                      className="min-w-0 flex-1 resize-none rounded-md border border-border px-2 py-1 text-xs leading-relaxed text-[#303030] outline-none focus:border-[#6366F1]"
                    />
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        onClick={saveDesc}
                        className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingDesc(false)}
                        className="text-xs text-muted-foreground hover:text-[#303030]"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="shrink-0 text-xs text-muted-foreground">描述</span>
                    <p className="min-w-0 flex-1 truncate text-xs text-[#303030]">
                      {selected.description || "暂无描述"}
                    </p>
                    <button
                      onClick={startEditDesc}
                      title="编辑描述"
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
                    >
                      <PencilSimple size={13} weight="bold" />
                    </button>
                  </>
                )}
              </div>

              {/* SOUL.md 编辑区 */}
              <div className="flex min-h-0 flex-1 flex-col px-5 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-2 text-xs font-medium text-[#303030]">
                    SOUL.md
                    {dirty && <span className="h-1.5 w-1.5 rounded-full bg-[#6366F1]" title="未保存" />}
                  </span>
                  <button
                    onClick={saveSoul}
                    disabled={!dirty}
                    className="rounded-md bg-foreground px-3 py-1 text-xs text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savedId === selected.id ? "已保存 ✓" : "保存"}
                  </button>
                </div>
                <textarea
                  value={soulDraft}
                  onChange={(e) => setSoulDraft(e.target.value)}
                  spellCheck={false}
                  className="min-h-0 flex-1 resize-none rounded-lg border border-border bg-[#FAFAFA] p-3 font-mono text-xs leading-relaxed text-[#303030] outline-none focus:border-[#6366F1]"
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-body-sm text-muted-foreground">
              选择一个档案查看详情
            </div>
          )}
        </div>
      </div>

      {/* Build 构建向导 */}
      <ProfileBuilderWizard
        open={showBuilder}
        onClose={() => setShowBuilder(false)}
        cloneOptions={profiles.map((p) => ({ id: p.id, name: p.name, provider: p.provider, model: p.model }))}
        onCreate={handleBuilderCreate}
      />
    </OverlayShell>
  );
}
