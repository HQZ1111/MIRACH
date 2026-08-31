/**
 * SettingsOverlay — 设置面板（精简版：通用设置 / 模型 / 插件 / 智能体预设 / 智能体团队 / 归档会话 / 安全 / 键盘快捷键 / 使用统计 / 关于）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { motion, AnimatePresence } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { EnvSettingsSection } from "@/components/settings/EnvSettingsSection";
import { useI18n, type Lang } from "@/lib/i18n";
import { useTheme } from "@/hooks/useTheme";
import { useAppConfig } from "@/hooks/useAppConfig";
import { $providerConfig, removeProviderConfig, type ProviderConfig } from "@/store/providerConfig";
import { $environments, envById, $envVersion, saveEnvironments, type EnvProfile } from "@/store/environments";
import { $passwordEnabled, clearAppPassword, enableAppPassword, hasPasswordData, setAppPassword, verifyAppPassword } from "@/store/password";
import { KEYBIND_ACTIONS, bindings, setBinding, resetAllBindings, ownerOf, comboFromEvent } from "@/lib/keybinds";
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
import { listTavernPresets, parseCharacterCard, parseCharacterCardPng, cardToPersona, presetToPersona, tavernPresetsRoot, type TavernPreset } from "@/lib/tavern";
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
import { $engineEnv } from "@/store/engine-session";
import { userHomeDir } from "@/lib/paths";
import { $usage, resetUsage } from "@/store/usage";
import { $agentMode, setAgentMode, $approvalMode, setApprovalMode, type AgentMode } from "@/store/agent";
import {
  $chatBackdrop,
  $chatStyle,
  $chatWidth,
  $defaultAgent,
  $enterBehavior,
  setChatBackdrop,
  setChatStyle,
  setChatWidth,
  setDefaultAgent,
  setEnterBehavior,
  type EnterBehavior,
} from "@/store/ui-settings";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ProviderConnectPanel, EditProviderForm } from "@/components/layout/ProviderConnectPanel";
import {
  Archive,
  Bot,
  Box,
  ChartBar,
  Check,
  ChevronDown,
  Copy,
  Download,
  FolderOpen,
  GitBranch,
  Info,
  Keyboard,
  Lock,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Search,
  Settings2,
  Trash2,
  Upload,
  Users,
  Brain,
  X,
  type LucideIcon,
  Layers,
} from "lucide-react";

interface SettingsSection {
  id: string;
  icon: LucideIcon;
}

const SECTIONS: SettingsSection[] = [
  { id: "general", icon: Settings2 },
  { id: "model", icon: Box },
  { id: "plugins", icon: Package },
  { id: "presets", icon: Bot },
  { id: "agents", icon: Users },
  { id: "memory", icon: Brain },
  { id: "sessions", icon: Archive },
  { id: "safety", icon: Lock },
  { id: "git", icon: GitBranch },
  { id: "keybinds", icon: Keyboard },
  { id: "usage", icon: ChartBar },
  { id: "about", icon: Info },
  { id: "envs", icon: Layers },
];

// ---- 表单控件 ----

function FieldRow({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="relative flex items-center justify-between gap-6 px-5 py-3 after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-border/60">
      <div className="min-w-0">
        <p className="text-body-sm font-medium text-[#303030]">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** 纵向设置行（zosma Chat Width 同款：标题在上，介绍在下，控件单独一行） */
function StackedRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="relative px-5 py-3 after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-border/60">
      <p className="text-body-sm font-medium text-[#303030]">{label}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      <div className="mt-2.5">{children}</div>
    </div>
  );
}

function TextInput({ defaultValue, placeholder, suffix }: { defaultValue?: string; placeholder?: string; suffix?: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      <input
        defaultValue={defaultValue}
        placeholder={placeholder ?? t("settings.notSet")}
        className="h-7 w-56 rounded-md border border-border bg-white px-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
      />
      {suffix && <span className="text-[11px] text-muted-foreground">{suffix}</span>}
    </div>
  );
}

function SelectInput({ options, defaultValue }: { options: string[]; defaultValue?: string }) {
  return (
    <select
      defaultValue={defaultValue}
      className="h-7 w-56 rounded-md border border-border bg-white px-2 text-body-sm text-[#303030] focus:outline-none"
    >
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function ListInput({ defaultValue }: { defaultValue?: string }) {
  return (
    <input
      defaultValue={defaultValue}
      placeholder="逗号分隔的值"
      className="h-7 w-56 rounded-md border border-border bg-white px-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
    />
  );
}

function SwitchInput({ defaultOn = false }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => setOn((v) => !v)}
      className={cn(
        "flex h-[18px] w-8 items-center rounded-full px-[2px] transition-colors",
        on ? "justify-end bg-[#303030]" : "justify-start bg-[#D1D5DB]",
      )}
    >
      <span className="h-[14px] w-[14px] rounded-full bg-white shadow-sm" />
    </button>
  );
}

function Segmented({
  options,
  defaultValue,
  value,
  onChange,
}: {
  options: string[];
  defaultValue?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [v, setV] = useState(defaultValue ?? options[0]);
  const current = value ?? v;
  return (
    <div className="flex overflow-hidden rounded-md border border-border">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => {
            setV(o);
            onChange?.(o);
          }}
          className={cn("px-2.5 py-1 text-xs transition-colors", current === o ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground")}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

/**
 * 滑块分段选择（zosma「Send feedback」Bug/Feature/General 同款：
 * grid radiogroup + motion 滑块 pill，layoutId 弹簧动画）。
 * 设置-通用设置里 主题/对话宽度/对话风格 用这个，单独一排。
 */
function SegmentedPill({
  options,
  value,
  onChange,
  ariaLabel,
  pillId,
}: {
  options: string[];
  value?: string;
  onChange?: (v: string) => void;
  ariaLabel?: string;
  pillId: string;
}) {
  const [v, setV] = useState(value ?? options[0]);
  const current = value ?? v;
  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-lg p-1"
      style={{ background: "hsl(var(--muted) / 0.5)" }}
      role="radiogroup"
      aria-label={ariaLabel}
    >
      {options.map((o) => {
        const active = current === o;
        return (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => {
              setV(o);
              onChange?.(o);
            }}
            className="relative rounded-md px-3 py-1.5 text-xs font-medium transition-colors active:scale-[0.97]"
            style={{ color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
          >
            {active && (
              <motion.div
                layoutId={pillId}
                className="absolute inset-0 rounded-md"
                style={{
                  background: "hsl(var(--card))",
                  boxShadow: "0 1px 4px hsl(0 0% 0% / 0.12)",
                }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
              />
            )}
            <span className="relative">{o}</span>
          </button>
        );
      })}
    </div>
  );
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="relative px-5 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-border/60">
      {children}
    </p>
  );
}

/**
 * 令牌一体式下拉（「下拉框统一换成令牌中一体式的下拉框」）：
 * 卡片一体展开（与 zosma CustomProviderRow 同款）—— .dropdown-card 外壳
 * 包住头部按钮 + borderTop 分隔的选项区，整个是一个圆角卡片在长高，
 * 非「按钮 + 独立边框阴影的分离浮层」。展开/收起走 motion 高度动画，
 * 切换选项时行高平滑变化，下方内容不跳动。外观走 --color-dropdown-* 令牌。
 */
function TokenSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  return (
    <div ref={wrapRef} className="w-56">
      <div className="dropdown-card">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
            className="dropdown-card-trigger dropdown-card-trigger-sm justify-between"
        >
          <span className="min-w-0 truncate">{selected?.label ?? placeholder ?? value}</span>
          <ChevronDown
            className={`dropdown-card-chevron shrink-0 ${open ? "rotate-180" : ""}`}
            strokeWidth={2}
          />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              key="token-menu"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{ overflow: "hidden" }}
            >
              <div className="dropdown-card-body">
                {options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className="block w-full px-3.5 py-2 text-left text-body-sm transition-colors hover:bg-[var(--color-dropdown-hover)]"
                    style={{ color: "var(--color-dropdown-title)" }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---- Model ----

function ModelContent({ onDone }: { onDone?: () => void }) {
  const configs = useStore($providerConfig);
  const [editing, setEditing] = useState<ProviderConfig | null>(null);
  const [deleting, setDeleting] = useState<ProviderConfig | null>(null);
  return (
    <div>
      {/* 已设置模型：保存的提供商卡片（状态点 + 编辑/删除） */}
      <div className="relative px-5 py-3 after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-border/60">
        <p className="text-body-sm font-medium text-[#303030]">已设置模型</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          下方添加 API 密钥或自定义端点后，配置的提供商会出现在这里；点编辑可修改配置
        </p>
        <div className="mt-2.5 space-y-2">
          {configs.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">尚未设置任何提供商</p>
          ) : (
            configs.map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/50 px-3 py-2">
                {/* 状态点：已连接绿 / 未连接灰 */}
                <span
                  className={cn("h-2 w-2 shrink-0 rounded-full", c.connected ? "bg-[#10B981]" : "bg-[#D1D5DB]")}
                />
                <span className="truncate text-body-sm font-medium text-[#303030]">{c.name}</span>
                {c.kind === "custom" && (
                  <span className="shrink-0 rounded bg-[#6366F1]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#6366F1]">自定义</span>
                )}
                <span className="shrink-0 text-[10px] text-muted-foreground">{c.connected ? "已连接" : "未连接"}</span>
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">{c.protocol}</span>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                  >
                    <Pencil className="h-3 w-3" strokeWidth={2} />
                    编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(c)}
                    className="flex items-center gap-1 rounded-md border border-[#EF4444]/40 px-2 py-1 text-[11px] text-[#EF4444] transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={2} />
                    删除
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
      {/* 初始页面「配置推理提供商」：API key + 自定义模型（ProviderConnectPanel 嵌入） */}
      <div className="relative px-5 py-3 after:pointer-events-none after:absolute after:inset-x-5 after:bottom-0 after:h-px after:bg-border/60">
        <ProviderConnectPanel embedded onDone={onDone ?? (() => {})} />
      </div>

      {/* 编辑提供商（内容与 apikey 表单对齐，无提供商下拉，顶部显示提供商名） */}
      {editing && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={() => setEditing(null)}>
          <div className="panel-glass popup-anim relative w-[400px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-member font-bold text-[#303030]">编辑「{editing.name}」</h3>
            <div className="mt-3 max-h-[60vh] overflow-y-auto pr-1">
              <EditProviderForm initial={editing} onDone={() => setEditing(null)} />
            </div>
          </div>
        </div>
      )}

      {/* 删除提供商确认 */}
      {deleting && (
        <ConfirmDialog
          open
          title="删除提供商"
          description={`确定删除「${deleting.name}」？其 API 密钥与模型配置将被移除。`}
          confirmLabel="删除"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            removeProviderConfig(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

// ---- General（通用设置，第一位；含外观/对话宽度/对话风格/聊天背景/Agent 预设/权限/语言/繁忙时 Enter） ----

/** dsh Agent 预设（I:\deepseek-harness\apps\cli\config\agent-presets：标准/PTC/极简/创造） */
const AGENT_PRESETS: { value: string; label: string; desc: string }[] = [
  { value: "standard", label: "标准模式", desc: "功能完整的编码 Agent，支持文件编辑、Shell、文件与网页检索、Skills、计划、目标、子代理和工作流" },
  { value: "code", label: "PTC 模式", desc: "具备标准模式的全部能力，并通过 Code Mode SDK 呈现工具，让模型用一个 TypeScript 程序组合多步操作" },
  { value: "minimal", label: "极简模式", desc: "仅提供持久 bash 与 str_replace_editor 的双工具编码 Agent" },
  { value: "cordis", label: "创造模式", desc: "用于创建自定义 Agent preset：具备标准模式的全部能力，并提供运行时检查、插件实验和 preset 创作指导" },
];

function GeneralContent() {
  const { t, lang, setLang } = useI18n();
  const { theme, setTheme } = useTheme();
  const chatWidth = useStore($chatWidth);
  const chatStyle = useStore($chatStyle);
  const backdrop = useStore($chatBackdrop);
  const defaultAgent = useStore($defaultAgent);
  const mode = useStore($agentMode);
  const enterBehavior = useStore($enterBehavior);
  const safePreset = AGENT_PRESETS.some((p) => p.value === defaultAgent) ? defaultAgent : "";

  return (
    <div>
      {/* ① 外观（浅色 / 深色 / 跟随系统）—— zosma 滑块组件，标题/介绍在上，滑块单独一行 */}
      <StackedRow
        label={t("settings.theme")}
        hint={theme === "system" ? "跟随系统外观" : theme === "dark" ? "深色界面" : "浅色界面"}
      >
        <SegmentedPill
          pillId="theme-pill"
          ariaLabel="主题"
          options={["浅色", "深色", "跟随系统"]}
          value={theme === "system" ? "跟随系统" : theme === "dark" ? "深色" : "浅色"}
          onChange={(v) => setTheme(v === "跟随系统" ? "system" : v === "深色" ? "dark" : "light")}
        />
      </StackedRow>

      {/* ② 对话宽度（大 / 中 / 小，参考 zosma 三档 820 / 1080 / 无限制）—— zosma 滑块组件 */}
      <StackedRow
        label={t("settings.chatWidth")}
        hint={chatWidth === "full" ? "全宽（无限制）" : chatWidth === "medium" ? "1080px" : "820px"}
      >
        <SegmentedPill
          pillId="chat-width-pill"
          ariaLabel="对话宽度"
          options={["小", "中", "大"]}
          value={chatWidth === "medium" ? "中" : chatWidth === "full" ? "大" : "小"}
          onChange={(v) => setChatWidth(v === "中" ? "medium" : v === "大" ? "full" : "small")}
        />
      </StackedRow>

      {/* ③ 对话风格（默认 / dsh系统 / 简约）—— zosma 滑块组件 */}
      <StackedRow
        label={t("settings.chatStyle")}
        hint="默认=现有对话界面；dsh系统=紧凑行式；简约=极简玻璃卡片"
      >
        <SegmentedPill
          pillId="chat-style-pill"
          ariaLabel="对话风格"
          options={["默认", "dsh系统", "简约"]}
          value={chatStyle === "minimal" ? "简约" : chatStyle === "dsh" ? "dsh系统" : "默认"}
          onChange={(v) => setChatStyle(v === "简约" ? "minimal" : v === "dsh系统" ? "dsh" : "default")}
        />
      </StackedRow>

      {/* ④ 聊天背景（放对话风格后面，持久化） */}
      <FieldRow label={t("settings.chatBackdrop")} hint="对话区背景装饰（淡色渐变 / 深色微光）">
        <Segmented
          options={["关闭", "开启"]}
          value={backdrop === "on" ? "开启" : "关闭"}
          onChange={(v) => setChatBackdrop(v === "开启" ? "on" : "off")}
        />
      </FieldRow>

      {/* ⑤ Agent 预设（dsh 四档：标准模式/PTC 模式/极简模式/创造模式，参考 dsh agent-presets） */}
      <FieldRow
        label={t("settings.agentPreset")}
        hint={AGENT_PRESETS.find((p) => p.value === safePreset)?.desc ?? "不指定时使用默认行为"}
      >
        <TokenSelect
          options={AGENT_PRESETS.map(({ value, label }) => ({ value, label }))}
          value={safePreset}
          onChange={setDefaultAgent}
          placeholder="默认（不指定）"
        />
      </FieldRow>

      {/* ⑥ 权限（dsh 三档：计划模式/工作区编辑/完全访问，联动对话区） */}
      <FieldRow label={t("settings.permission")} hint="计划模式=只分析规划；工作区编辑=自动批准文件修改；完全访问=无需逐项确认">
        <TokenSelect
          options={[
            { value: "plan", label: "计划模式" },
            { value: "workspace", label: "工作区编辑" },
            { value: "full", label: "完全访问" },
          ]}
          value={mode}
          onChange={(v) => setAgentMode(v as AgentMode)}
        />
      </FieldRow>

      {/* ⑦ 语言（中文 / English） */}
      <FieldRow label={t("settings.language")}>
        <div className="flex overflow-hidden rounded-md border border-border">
          {([
            { id: "zh", label: "中文" },
            { id: "en", label: "English" },
          ] as { id: Lang; label: string }[]).map((l) => (
            <button
              key={l.id}
              onClick={() => setLang(l.id)}
              className={cn("px-3 py-1 text-xs transition-colors", lang === l.id ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground")}
            >
              {l.label}
            </button>
          ))}
        </div>
      </FieldRow>

      {/* ⑧ 繁忙时 Enter 键行为（排队 / 插话转向） */}
      <FieldRow label={t("settings.enterBehavior")} hint="回复中按 Enter：排队发送，或插话发送（转向，真实模式流式中生效）">
        <TokenSelect
          options={[
            { value: "queue", label: "排队发送" },
            { value: "steer", label: "插话发送（转向）" },
          ]}
          value={enterBehavior}
          onChange={(v) => setEnterBehavior(v as EnterBehavior)}
        />
      </FieldRow>

      <WorkEnvironmentsSection />
    </div>
  );
}

// ---- 工作环境（环境隔离） ----

/**
 * 环境与左栏模式一一绑定（主/hermes=主环境；代码/工作/金融写作各一环境）。
 * 切换左栏模式即切换工作区：引擎 bash/fs 工具目录、会话映射命名空间、
 * 持久化历史分组都随环境隔离（对齐 dsh 按 cwd 分组会话的原生语义）。
 * 这里只维护每个环境的显示名与工作区路径。
 */
function WorkEnvironmentsSection() {
  const envs = useStore($environments);
  const envVer = useStore($envVersion);
  const [draft, setDraft] = useState<EnvProfile[] | null>(null);
  const [adding, setAdding] = useState(false);
  const list = draft ?? envs;

  const commit = (next: EnvProfile[]) => {
    setDraft(next); // 编辑态立即反映；失焦/保存时落库
  };
  const saveNow = (next?: EnvProfile[]) => {
    const final = next ?? list;
    saveEnvironments(final);
    setDraft(null);
  };

  // 添加环境：新环境绑定到一个尚无环境绑定的左栏视图（否则切换视图不会进入它）
  const usedViews = new Set(list.map((e) => e.id));
  const freeViews = ["code", "work", "finance", "write"].filter((v) => !usedViews.has(v));

  return (
    <div className="mt-1 rounded-lg border border-border p-3" data-env-version={envVer}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">工作环境</p>
          <p className="text-xs text-muted-foreground">
            与左侧栏模式绑定；切换模式后对话的工作区、上下文与历史互相隔离。首次使用会自动创建对应文件夹。
          </p>
        </div>
        {draft && (
          <button
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted"
            onClick={() => saveNow()}
          >
            保存环境
          </button>
        )}
      </div>
      <div className="space-y-2">
        {list.map((e, i) => (
          <div key={e.id} className="grid grid-cols-[92px_1fr_1fr] items-center gap-2">
            <input
              className="h-8 rounded-md border border-border bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#2E5BFF]/40"
              value={e.name}
              aria-label={`环境 ${i + 1} 名称`}
              onChange={(ev) => {
                const next = [...list];
                next[i] = { ...e, name: ev.target.value };
                commit(next);
              }}
              onBlur={() => e.name.trim() && saveNow()}
            />
            <input
              className="col-span-2 h-8 rounded-md border border-border bg-transparent px-2 font-mono text-xs text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#2E5BFF]/40"
              value={e.cwd}
              placeholder="空 = 用户主目录"
              aria-label={`环境 ${i + 1} 工作区`}
              onChange={(ev) => {
                const next = [...list];
                next[i] = { ...e, cwd: ev.target.value };
                commit(next);
              }}
              onBlur={() => saveNow()}
            />
          </div>
        ))}
      </div>
      {/* 添加环境：把空闲的左栏视图登记为环境（名称/工作区可再编辑） */}
      {!adding && freeViews.length > 0 && (
        <button
          className="mt-2 w-full rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
          onClick={() => setAdding(true)}
        >
          ＋ 添加工作环境（绑定左栏模式：{freeViews.join(" / ")}）
        </button>
      )}
      {adding && freeViews.length > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            autoFocus
            defaultValue=""
            onChange={(ev) => {
              const view = ev.target.value as string;
              if (!view) return;
              const seeds: Record<string, string> = {
                code: "代码", work: "工作", finance: "金融写作", write: "写作",
              };
              commit([...list, { id: view, name: seeds[view] ?? view, cwd: `G:\\Workspaces\\${view}` }]);
              setAdding(false);
              window.setTimeout(() => saveNow(), 0);
            }}
            className="h-8 flex-1 rounded-md border border-border bg-white px-2 text-xs"
          >
            <option value="">选择要启用的左栏模式…</option>
            {freeViews.map((v) => (
              <option key={v} value={v}>
                {{ code: "代码", work: "工作", finance: "金融", write: "写作" }[v] ?? v}
              </option>
            ))}
          </select>
          <button
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
            onClick={() => setAdding(false)}
          >
            取消
          </button>
        </div>
      )}
      {freeViews.length === 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">全部左栏模式都已启用为工作环境。</p>
      )}
      {draft && <p className="mt-2 text-[11px] text-[#2E5BFF]">有未保存的修改——点「保存环境」生效并重载当前会话。</p>}
    </div>
  );
}

// ---- Safety ----

function SafetyContent() {
  const { t } = useI18n();
  const pwEnabled = useStore($passwordEnabled);
  const approvalMode = useStore($approvalMode);
  const [pwModal, setPwModal] = useState<null | "set" | "change">(null);

  const togglePw = (on: boolean) => {
    if (on) {
      // 有保留的密码数据 → 直接沿用原密码开启；否则要求新设置
      if (hasPasswordData()) enableAppPassword();
      else setPwModal("set");
    } else if (window.confirm("关闭密码登录？下次启动将不再要求输入密码（密码数据保留，可随时重新开启）。")) {
      clearAppPassword();
    }
  };

  return (
    <div>
      <SubHeading>启动密码</SubHeading>
      <FieldRow label="密码登录" hint="开启后每次启动先输入密码（主界面在其背后）；关闭则先播连接动画再进主页">
        <button
          role="switch"
          aria-checked={pwEnabled}
          onClick={() => togglePw(!pwEnabled)}
          className={cn(
            "flex h-[18px] w-8 items-center rounded-full px-[2px] transition-colors",
            pwEnabled ? "justify-end bg-[#303030]" : "justify-start bg-[#D1D5DB]",
          )}
        >
          <span className="h-[14px] w-[14px] rounded-full bg-white shadow-sm" />
        </button>
      </FieldRow>
      <FieldRow label="修改密码" hint={pwEnabled ? "更换启动密码" : "先开启密码登录"}>
        <button
          onClick={() => setPwModal("change")}
          disabled={!pwEnabled}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
        >
          修改密码
        </button>
      </FieldRow>
      {pwModal && <PasswordModal mode={pwModal} onClose={() => setPwModal(null)} />}

      <FieldRow label={t("settings.approvalMode")}>
        <select
          value={approvalMode}
          onChange={(e) => setApprovalMode(e.target.value as "manual" | "smart" | "off")}
          className="h-7 w-56 rounded-md border border-border bg-white px-2 text-body-sm text-[#303030] focus:outline-none"
        >
          <option value="manual">手动（工具需审批）</option>
          <option value="smart">智能（按模式）</option>
          <option value="off">关闭（自动批准）</option>
        </select>
      </FieldRow>
      <FieldRow label={t("settings.approvalTimeout")}><TextInput defaultValue="300" /></FieldRow>
      <FieldRow label={t("settings.confirmMcpReload")}><SwitchInput defaultOn /></FieldRow>
      <FieldRow label={t("settings.commandAllowlist")}><ListInput /></FieldRow>
      <FieldRow label={t("settings.redactSecrets")}><SwitchInput defaultOn /></FieldRow>
      <FieldRow label={t("settings.allowPrivateUrls")}><SwitchInput /></FieldRow>
      <FieldRow label={t("settings.browserPrivateUrls")}><SwitchInput /></FieldRow>
      <FieldRow label={t("settings.localBrowserPrivate")}><SwitchInput defaultOn /></FieldRow>
      <FieldRow label={t("settings.fileCheckpoints")}><SwitchInput /></FieldRow>
    </div>
  );
}

// ---- Git 账户 ----

function GitContent() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = async () => {
    try {
      const u = await invoke<{ name: string | null; email: string | null }>("git_get_user");
      setName(u.name ?? "");
      setEmail(u.email ?? "");
    } catch {
      setMsg({ kind: "err", text: "读取 Git 身份失败（未安装 git？）" });
    } finally {
      setLoaded(true);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    setSaveBusy(true);
    setMsg(null);
    try {
      await invoke("git_set_user", { name: name.trim(), email: email.trim() });
      setMsg({ kind: "ok", text: "已保存（写入 git config --global）" });
    } catch (e) {
      setMsg({ kind: "err", text: `保存失败：${String(e)}` });
    } finally {
      setSaveBusy(false);
    }
  };

  const clearCred = async () => {
    setClearBusy(true);
    setMsg(null);
    try {
      await invoke("git_clear_credential", { host: "gitee.com" });
      setMsg({ kind: "ok", text: "已清除 Gitee 登录信息，下次推送时会重新弹出登录框" });
    } catch (e) {
      setMsg({ kind: "err", text: `清除失败：${String(e)}` });
    } finally {
      setClearBusy(false);
    }
  };

  const inputCls =
    "w-72 rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]";

  return (
    <div>
      <SubHeading>提交身份</SubHeading>
      <FieldRow label="用户名（user.name）" hint="git commit 的署名，写入 git config --global">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="未设置" />
      </FieldRow>
      <FieldRow label="邮箱（user.email）" hint="git commit 的署名邮箱，写入 git config --global">
        <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="未设置" />
      </FieldRow>
      <div className="flex items-center gap-2 px-5 py-3">
        <button
          onClick={() => void save()}
          disabled={saveBusy || !loaded}
          className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {saveBusy ? "保存中…" : "保存"}
        </button>
        {msg && msg.kind === "ok" && <span className="text-[11px] text-[#10B981]">{msg.text}</span>}
        {msg && msg.kind === "err" && <span className="text-[11px] text-[#EF4444]">{msg.text}</span>}
      </div>

      <SubHeading>远程登录（Gitee）</SubHeading>
      <FieldRow label="登录密码" hint="密码保存在 Windows 凭据管理器（git 自动读取），软件不保存密码">
        <span className="text-body-sm text-muted-foreground">已由凭据管理器托管</span>
      </FieldRow>
      <FieldRow label="清除登录信息" hint="清除后下次推送会重新弹登录框输新密码（改密码 / 切换账户时用）">
        <button
          onClick={() => setConfirmClear(true)}
          disabled={clearBusy}
          className="rounded-md border border-[#EF4444]/40 px-2.5 py-1 text-xs text-[#EF4444] transition-colors hover:bg-red-50 disabled:opacity-40"
        >
          {clearBusy ? "清除中…" : "清除已保存的 Gitee 登录信息"}
        </button>
      </FieldRow>

      <ConfirmDialog
        open={confirmClear}
        title="清除 Gitee 登录信息"
        description="将删除 Windows 凭据管理器中保存的 Gitee 登录密码。下次推送 / 拉取时会重新弹出登录框。确定继续？"
        confirmLabel="清除"
        onConfirm={() => {
          setConfirmClear(false);
          void clearCred();
        }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}

/** 设置 / 修改启动密码弹窗 */
function PasswordModal({ mode, onClose }: { mode: "set" | "change"; onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inputCls =
    "w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]";

  const submit = async () => {
    setError(null);
    if (pw.length < 4) {
      setError("密码至少 4 位");
      return;
    }
    if (pw !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    if (mode === "change") {
      const ok = await verifyAppPassword(current);
      if (!ok) {
        setBusy(false);
        setError("当前密码错误");
        return;
      }
    }
    try {
      await setAppPassword(pw);
      setBusy(false);
      onClose();
    } catch (e) {
      setBusy(false);
      setError(String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md">
      <div className="absolute inset-0" onClick={onClose} />
      <div className="panel-glass popup-anim relative w-80 rounded-2xl p-5">
        <h3 className="text-member font-bold text-[#303030]">{mode === "set" ? "设置启动密码" : "修改启动密码"}</h3>
        <div className="mt-3 space-y-2">
          {mode === "change" && (
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="当前密码" className={inputCls} />
          )}
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="新密码（至少 4 位）" className={inputCls} />
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="确认新密码" className={inputCls} />
          {error && <p className="text-[11px] text-[#EF4444]">{error}</p>}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted">
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Keybinds ----

function formatCombo(combo: string): string {
  return combo
    .split("+")
    .map((p) => {
      switch (p) {
        case "ctrl": return "Ctrl";
        case "shift": return "Shift";
        case "alt": return "Alt";
        case "meta": return "Meta";
        case "mod": return "Cmd/Ctrl";
        case "space": return "Space";
        case "enter": return "Enter";
        case "escape": return "Esc";
        case "arrowup": return "↑";
        case "arrowdown": return "↓";
        case "arrowleft": return "←";
        case "arrowright": return "→";
        default: return p.length === 1 ? p.toUpperCase() : p;
      }
    })
    .join(" ");
}

function KeybindsContent() {
  const { t } = useI18n();
  const [map, setMap] = useState<Record<string, string>>(bindings);
  const [capturing, setCapturing] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);

  // 捕获模式：等待用户按下新组合键（Esc 取消；裸修饰键忽略；冲突不保存并提示）
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setCapturing(null);
        setConflict(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;
      const owner = ownerOf(combo, capturing);
      if (owner) {
        setConflict(KEYBIND_ACTIONS.find((a) => a.id === owner)?.label ?? owner);
        return;
      }
      setBinding(capturing, combo);
      setMap(bindings());
      setCapturing(null);
      setConflict(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [capturing]);

  const groups = useMemo(() => {
    const g = new Map<string, typeof KEYBIND_ACTIONS>();
    for (const a of KEYBIND_ACTIONS) {
      if (!g.has(a.group)) g.set(a.group, []);
      g.get(a.group)!.push(a);
    }
    return [...g.entries()];
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-2">
        <p className="text-body-sm text-muted-foreground">{t("settings.keyboardShortcuts")} · 点击组合键重绑定，即时生效</p>
        <button
          onClick={() => {
            resetAllBindings();
            setMap(bindings());
            setCapturing(null);
            setConflict(null);
          }}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
        >
          {t("settings.resetAll")}
        </button>
      </div>
      {capturing && (
        <p className="px-5 pb-2 text-body-sm text-[#6366F1]">
          按下新的快捷键…{conflict && <span className="ml-1 text-[#EF4444]">（“{conflict}”已占用此组合，请换一个）</span>}（Esc 取消）
        </p>
      )}
      {groups.map(([g, acts]) => (
        <div key={g}>
          <SubHeading>{g}</SubHeading>
          {acts.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-5 py-2.5">
              <span className="text-body-sm text-[#303030]">{a.label}</span>
              {a.fixed ? (
                <kbd className="rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-[11px] text-[#303030]">{formatCombo(map[a.id] ?? a.defaultCombo)}</kbd>
              ) : (
                <button
                  onClick={() => {
                    setCapturing(a.id);
                    setConflict(null);
                  }}
                  className={cn(
                    "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors",
                    capturing === a.id
                      ? "border-[#6366F1] bg-indigo-50 text-[#6366F1]"
                      : "border-border bg-muted text-[#303030] hover:border-[#6366F1]/50",
                  )}
                  title="点击重绑定"
                >
                  {capturing === a.id ? "按下新组合…" : formatCombo(map[a.id] ?? a.defaultCombo)}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---- Plugins（对齐 dsh ui-settings-plugins：插件配置 / 插件列表 两个页签） ----

/** 插件配置卡字段（对齐 dsh fields.tsx：ValueField 文本/数字 + SecretField 密码） */
interface PluginField {
  key: string;
  label: string;
  type: "text" | "secret" | "number";
  defaultValue: string;
  placeholder?: string;
}

/** 可配置插件（对齐 dsh PluginCard：Shell / Agent 循环 / 网页搜索 三个命名空间） */
const PLUGIN_CARDS: { title: string; ns: string; desc: string; fields: PluginField[] }[] = [
  {
    title: "Shell（终端）",
    ns: "shell",
    desc: "命令执行超时与单次输出上限，超时即终止",
    fields: [
      { key: "timeoutMs", label: "命令超时（毫秒）", type: "number", defaultValue: "30000", placeholder: "30000" },
      { key: "maxOutputBytes", label: "单流内存输出上限（字节）", type: "number", defaultValue: "1048576", placeholder: "1048576" },
    ],
  },
  {
    title: "Agent 循环",
    ns: "agent-loop",
    desc: "同一回复内最多同时运行的并行工具调用数",
    fields: [{ key: "maxParallelToolCalls", label: "最大并行工具调用", type: "number", defaultValue: "8", placeholder: "8" }],
  },
  {
    title: "网页搜索",
    ns: "web-search-deepseek",
    desc: "DeepSeek 网页搜索供应商；密钥写凭证域，留空保持不变",
    fields: [
      { key: "apiKey", label: "API Key", type: "secret", defaultValue: "", placeholder: "sk-…" },
      { key: "baseURL", label: "Base URL", type: "text", defaultValue: "", placeholder: "留空使用默认值" },
      { key: "maxUses", label: "单次请求最多搜索次数", type: "number", defaultValue: "10", placeholder: "10" },
    ],
  },
];

/** 读取插件配置（合并内置默认）；空值 = 使用内置默认 */
function loadPluginValues(ns: string, fields: PluginField[]): Record<string, string> {
  const defaults = Object.fromEntries(fields.map((f) => [f.key, f.defaultValue]));
  try {
    const all = JSON.parse(localStorage.getItem("mirach.pluginSettings.v1") ?? "{}") as Record<string, Record<string, string>>;
    return { ...defaults, ...(all[ns] ?? {}) };
  } catch {
    return defaults;
  }
}

function savePluginValues(ns: string, values: Record<string, string>): void {
  try {
    const all = JSON.parse(localStorage.getItem("mirach.pluginSettings.v1") ?? "{}") as Record<string, Record<string, string>>;
    all[ns] = { ...values };
    for (const k of Object.keys(all[ns])) if (!all[ns][k]) delete all[ns][k];
    localStorage.setItem("mirach.pluginSettings.v1", JSON.stringify(all));
  } catch {
    /* 存储失败忽略 */
  }
}

/** 折叠配置卡：头部（名称+描述+未保存徽标+chevron）+ 表单 + 底部 丢弃/保存（dsh 暂存—保存模型） */
function PluginConfigCard({ card }: { card: (typeof PLUGIN_CARDS)[number] }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() => loadPluginValues(card.ns, card.fields));
  const [dirty, setDirty] = useState(false);

  return (
    <div className="dropdown-card">
      <button type="button" onClick={() => setOpen((v) => !v)} className="dropdown-card-trigger">
        <span className="flex-1 text-body-sm font-medium">{card.title}</span>
        <span className="hidden text-[10px] text-dropdown-sub sm:inline">{card.desc}</span>
        {dirty && <span className="rounded bg-[#F59E0B]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#B45309]">未保存</span>}
        <ChevronDown className={`dropdown-card-chevron ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open && (
        <div className="dropdown-card-body space-y-2 p-2.5">
          {card.fields.map((f) => (
            <label key={f.key} className="block">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[#303030]">
                {f.label}
                {f.type === "secret" && values[f.key] && (
                  <span className="rounded bg-[#10B981]/10 px-1 py-px text-[10px] font-normal text-[#10B981]">已配置</span>
                )}
              </span>
              <input
                type={f.type === "secret" ? "password" : "text"}
                inputMode={f.type === "number" ? "numeric" : undefined}
                value={values[f.key]}
                placeholder={f.placeholder}
                autoComplete="off"
                onChange={(e) => {
                  setValues((v) => ({ ...v, [f.key]: e.target.value }));
                  setDirty(true);
                }}
                className="mt-0.5 w-full rounded-md border border-border px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#026CFE]"
              />
            </label>
          ))}
          <div className="flex justify-end gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                setValues(loadPluginValues(card.ns, card.fields));
                setDirty(false);
              }}
              disabled={!dirty}
              className="rounded-md border border-border px-2.5 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted disabled:opacity-40"
            >
              丢弃修改
            </button>
            <button
              type="button"
              onClick={() => {
                savePluginValues(card.ns, values);
                setDirty(false);
              }}
              disabled={!dirty}
              className="rounded-md bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** 插件列表条目：真实来源 = 生成 cordis.yml 的插件条目（entryId/name/config），
 *  挂载状态引擎未导出 RPC，统一标注"随会话启动挂载"。 */
interface PluginInventoryEntry {
  entryId: string;
  moduleName: string;
  enabled: boolean;
  phase: "pending" | "loading" | "active" | "failed" | "unloading" | null;
}

const PHASE_TEXT: Record<string, string> = {
  pending: "等待依赖",
  loading: "加载中",
  active: "已挂载",
  failed: "挂载失败",
  unloading: "卸载中",
  null: "未挂载",
};

const PHASE_COLOR: Record<string, string> = {
  pending: "#F59E0B",
  loading: "#F59E0B",
  active: "#10B981",
  failed: "#EF4444",
  unloading: "#8B5CF6",
  null: "#9CA3AF",
};

/** 从 sidecar 生成的 cordis.yml 读插件清单（真实部署配置；拉取失败回空列表） */
async function fetchPluginInventory(): Promise<PluginInventoryEntry[]> {
  try {
    const r = await invoke<{ entries?: { id: string; name?: string }[] }>("dsh_rpc", {
      method: "config.pluginEntries",
      params: {},
    });
    return (r?.entries ?? []).map((e) => ({
      entryId: `cordis:${e.id}`,
      moduleName: e.name ?? e.id,
      enabled: true,
      phase: "active" as const,
    }));
  } catch {
    return [];
  }
}

/** 模块短名：去掉 @scope/、cordis-plugin-、dsh- 前缀 */
function moduleShortName(moduleName: string): string {
  return moduleName.replace(/^@[^/]+\//, "").replace(/^(cordis-plugin-|dsh-)/, "");
}

function PluginsContent() {
  const [tab, setTab] = useState<"config" | "list">("config");
  const [query, setQuery] = useState("");
  const [openEntries, setOpenEntries] = useState<ReadonlySet<string>>(new Set());
  // 插件清单真化：读 sidecar 生成 cordis.yml 的插件条目（本部署真实装配）
  const [inventory, setInventory] = useState<PluginInventoryEntry[] | null>(null);
  useEffect(() => {
    let alive = true;
    void fetchPluginInventory().then((list) => {
      if (alive) setInventory(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  const q = query.trim().toLowerCase();
  const filtered = (inventory ?? []).filter(
    (p) => p.moduleName.toLowerCase().includes(q) || p.entryId.toLowerCase().includes(q),
  );

  return (
    <div>
      <p className="px-5 py-2 text-body-sm text-muted-foreground">配置和查看本部署已安装的插件。</p>

      {/* 页签栏（dsh settings.plugins.tab：插件配置 / 插件列表） */}
      <div className="flex gap-1 px-5 pt-1">
        {(
          [
            ["config", "插件配置"],
            ["list", "插件列表"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs transition-colors",
              tab === id ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground hover:bg-muted/60",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "config" ? (
        <div className="space-y-2 px-5 py-3">
          {PLUGIN_CARDS.map((c) => (
            <PluginConfigCard key={c.ns} card={c} />
          ))}
        </div>
      ) : (
        <div className="px-5 py-3">
          {/* 搜索（dsh PluginInventorySettingsTab：按 moduleName / entryId 过滤） */}
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件…"
              className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
            />
          </div>
          <div className="mt-2 space-y-1.5">
            {filtered.map((p) => {
              const open = openEntries.has(p.entryId);
              return (
                <div key={p.entryId} className="rounded-lg border border-border">
                  <button
                    type="button"
                    onClick={() =>
                      setOpenEntries((s) => {
                        const next = new Set(s);
                        if (!next.delete(p.entryId)) next.add(p.entryId);
                        return next;
                      })
                    }
                    className="flex w-full items-center gap-2 px-3 py-2 text-left"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: p.enabled ? PHASE_COLOR[p.phase ?? "null"] : "#D1D5DB" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-[#303030]">
                      {moduleShortName(p.moduleName)}
                    </span>
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[10px] font-medium",
                        p.enabled ? "bg-[#10B981]/10 text-[#10B981]" : "bg-muted text-muted-foreground",
                      )}
                    >
                      {p.enabled ? "已启用" : "已禁用"}
                    </span>
                    <ChevronDown
                      className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                      strokeWidth={2}
                    />
                  </button>
                  {open && (
                    <div className="space-y-1 border-t border-border px-3 py-2">
                      <p className="font-mono text-[10px] text-muted-foreground">{p.entryId}</p>
                      <div className="flex flex-wrap gap-1">
                        <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">{p.moduleName}</span>
                        <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                          Cordis: {PHASE_TEXT[p.phase ?? "null"]}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {inventory === null && (
              <p className="py-2 text-center text-[11px] text-muted-foreground">正在从引擎读取插件清单…</p>
            )}
            {inventory !== null && filtered.length === 0 && (
              <p className="py-2 text-center text-[11px] leading-relaxed text-muted-foreground">
                {query ? "没有匹配的插件" : "引擎未连接或清单为空——启动应用后重试"}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Archived ----

function SessionsContent() {
  const { t } = useI18n();
  const sessions = [
    { title: "主项目会话", meta: "hermes-chat · 42 条消息" },
    { title: "架构讨论", meta: "hermes-chat · 18 条消息" },
    { title: "Rust 后端重构", meta: "hermes-chat · 57 条消息" },
  ];
  return (
    <div>
      <FieldRow label={t("settings.defaultProjectDir")}>
        <div className="flex items-center gap-2">
          <TextInput defaultValue="C:\Users\Administrator\.myhermes" />
          <button className="rounded-md border border-border px-2 py-1 text-xs text-[#464646] transition-colors hover:bg-muted">{t("settings.change")}</button>
        </div>
      </FieldRow>
      <FieldRow label={t("settings.autoArchive")} hint="闲置 3 天后自动归档">
        <SwitchInput defaultOn />
      </FieldRow>
      <FieldRow label="启动时恢复上次会话" hint="打开应用时回到上次的会话与标签">
        <SwitchInput defaultOn />
      </FieldRow>
      <FieldRow label="会话保留上限" hint="超过上限自动归档最旧会话">
        <SelectInput options={["50", "100", "250", "500", "不限"]} defaultValue="250" />
      </FieldRow>
      <SubHeading>{t("settings.archivedSessions")}</SubHeading>
      {sessions.map((s) => (
        <div key={s.title} className="flex items-center justify-between px-5 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-body-sm font-medium text-[#303030]">{s.title}</p>
            <p className="text-[11px] text-muted-foreground">{s.meta}</p>
          </div>
          <div className="flex gap-1.5">
            <button className="rounded-md border border-border px-2 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted">{t("settings.unarchive")}</button>
            <button className="rounded-md border border-border px-2 py-0.5 text-[11px] text-[#EF4444] transition-colors hover:bg-red-50">{t("settings.delete")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Presets（智能体预设，对齐 dsh AgentPresetSection：内置/自定义两组卡片） ----

/** 预设 id 规则（dsh PRESET_ID：小写字母/数字，连字符分段，字母或数字开头） */
const PRESET_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface CustomPreset {
  id: string;
  name: string;
  desc: string;
  from?: string;
}

const CUSTOM_PRESET_KEY = "mirach.agentPresets.v1";

function readCustomPresets(): CustomPreset[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_PRESET_KEY) ?? "[]") as CustomPreset[];
  } catch {
    return [];
  }
}

/** 预设组装文件演示内容（真实模式读取该预设目录下的 agent.cordis.yml 原文） */
function presetAssembly(presetId: string): string {
  return [
    `# agent.cordis.yml — ${presetId}`,
    "",
    "persona:             @deepseek-ai/dsh-persona",
    "agent-instructions:  @deepseek-ai/dsh-agent-instructions",
    "tool-bash:           @deepseek-ai/dsh-tool-bash",
    "tool-fs:             @deepseek-ai/dsh-tool-fs",
    "tool-fs-search:      @deepseek-ai/dsh-tool-fs-search",
    "tool-web:            @deepseek-ai/dsh-tool-web",
    "tool-skill:          @deepseek-ai/dsh-tool-skill",
    "planning:            @deepseek-ai/dsh-planning",
    "compaction:          @deepseek-ai/dsh-compaction",
    "",
    "# 演示内容：真实模式读取该预设目录下的 agent.cordis.yml 原文",
  ].join("\n");
}

/** 复制预设对话框（dsh CopyDialog：标识符 + 名称，正则校验 + 占用检查） */
function CopyPresetDialog({
  fromName,
  existing,
  onCancel,
  onConfirm,
}: {
  fromName: string;
  existing: string[];
  onCancel: () => void;
  onConfirm: (id: string, name: string) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const invalid = id.length > 0 && !PRESET_ID_PATTERN.test(id);
  const taken = existing.includes(id);
  const canSave = id.length > 0 && !invalid && !taken;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={onCancel}>
      <div className="panel-glass popup-anim relative w-80 rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-member font-bold text-[#303030]">复制预设「{fromName}」</h3>
        <div className="mt-3 space-y-2">
          <label className="block">
            <span className="text-[11px] text-muted-foreground">标识符（目录名）</span>
            <input
              autoFocus
              value={id}
              onChange={(e) => setId(e.target.value.toLowerCase())}
              onKeyDown={(e) => e.key === "Enter" && canSave && onConfirm(id, name)}
              placeholder="my-preset"
              className="mt-0.5 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
            />
            {invalid && <span className="mt-0.5 block text-[10px] text-[#EF4444]">只能小写字母/数字，连字符分段</span>}
            {taken && <span className="mt-0.5 block text-[10px] text-[#EF4444]">该标识符已存在</span>}
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">名称（可选）</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={fromName}
              className="mt-0.5 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
            />
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted">
            取消
          </button>
          <button
            onClick={() => onConfirm(id, name)}
            disabled={!canSave}
            className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            复制
          </button>
        </div>
      </div>
    </div>
  );
}

function PresetsContent() {
  const defaultAgent = useStore($defaultAgent);
  const [custom, setCustom] = useState<CustomPreset[]>(readCustomPresets());
  const [copyFrom, setCopyFrom] = useState<{ id: string; name: string } | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<CustomPreset | null>(null);

  const persist = (list: CustomPreset[]) => {
    setCustom(list);
    try {
      localStorage.setItem(CUSTOM_PRESET_KEY, JSON.stringify(list));
    } catch {
      /* 存储失败忽略 */
    }
  };

  const confirmCopy = (id: string, name: string) => {
    if (!copyFrom) return;
    persist([...custom, { id, name: name.trim() || id, desc: `基于「${copyFrom.name}」复制的自定义预设`, from: copyFrom.id }]);
    setCopyFrom(null);
  };

  return (
    <div>
      <p className="px-5 py-2 text-body-sm text-muted-foreground">
        预设决定新会话装配的智能体行为（模型、工具、权限与提示词）；内置预设随应用分发，复制后可自定义。
      </p>

      {/* 内置预设组（dsh system 组） */}
      <SubHeading>内置</SubHeading>
      <div className="space-y-2 px-5 py-2">
        {AGENT_PRESETS.map((p) => {
          const isDefault = defaultAgent === p.value;
          return (
            <div key={p.value} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-body-sm font-medium text-[#303030]">{p.label}</span>
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">内置</span>
                {isDefault && (
                  <span className="rounded bg-[#10B981]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#10B981]">当前使用</span>
                )}
                <code className="ml-auto font-mono text-[10px] text-muted-foreground">{p.value}</code>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{p.desc}</p>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDefaultAgent(p.value)}
                  aria-pressed={isDefault}
                  disabled={isDefault}
                  className="rounded-md bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  设为默认
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setViewId(p.value)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                  >
                    查看
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyFrom({ id: p.value, name: p.label })}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    复制
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 自定义预设组（dsh user 组） */}
      <SubHeading>自定义</SubHeading>
      <div className="space-y-2 px-5 py-2">
        {custom.length === 0 && (
          <p className="text-[11px] text-muted-foreground">暂无自定义预设。用「创造模式」创作，或复制一个内置预设。</p>
        )}
        {custom.map((c) => {
          const isDefault = defaultAgent === c.id;
          return (
            <div key={c.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="text-body-sm font-medium text-[#303030]">{c.name}</span>
                <span className="rounded bg-[#6366F1]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#6366F1]">自定义</span>
                {isDefault && (
                  <span className="rounded bg-[#10B981]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#10B981]">当前使用</span>
                )}
                <code className="ml-auto font-mono text-[10px] text-muted-foreground">{c.id}</code>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{c.desc}</p>
              <div className="mt-2 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setDefaultAgent(c.id)}
                  aria-pressed={isDefault}
                  disabled={isDefault}
                  className="rounded-md bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  设为默认
                </button>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => window.alert(`（演示）打开预设目录：~/.hermes/agent-presets/${c.id}`)}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                  >
                    <FolderOpen className="h-3 w-3" strokeWidth={2} />
                    打开目录
                  </button>
                  <button
                    type="button"
                    onClick={() => setCopyFrom({ id: c.id, name: c.name })}
                    className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted"
                  >
                    <Copy className="h-3 w-3" strokeWidth={2} />
                    复制
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDel(c)}
                    className="flex items-center gap-1 rounded-md border border-[#EF4444]/40 px-2 py-1 text-[11px] text-[#EF4444] transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-3 w-3" strokeWidth={2} />
                    删除
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3">
        <button
          type="button"
          onClick={() => window.alert("已创建「创造模式」预设草稿（演示）。真实模式会启动新会话并用该预设装配。")}
          className="rounded-md border border-dashed border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
        >
          用「创造模式」创作自定义预设
        </button>
      </div>

      {copyFrom && (
        <CopyPresetDialog
          fromName={copyFrom.name}
          existing={[...AGENT_PRESETS.map((p) => p.value), ...custom.map((c) => c.id)]}
          onCancel={() => setCopyFrom(null)}
          onConfirm={confirmCopy}
        />
      )}

      {viewId && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={() => setViewId(null)}>
          <div className="panel-glass popup-anim relative w-[440px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-member font-bold text-[#303030]">
              预设「{AGENT_PRESETS.find((p) => p.value === viewId)?.label ?? viewId}」 · agent.cordis.yml
            </h3>
            <pre className="mt-3 max-h-[50vh] overflow-auto rounded-lg bg-black/5 p-3 font-mono text-[11px] leading-relaxed text-[#303030]">
              {presetAssembly(viewId)}
            </pre>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setViewId(null)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDel !== null}
        title="删除自定义预设"
        description={"确定删除「" + (confirmDel?.name ?? "") + "」吗？该预设将从列表中移除。"}
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmDel) persist(custom.filter((c) => c.id !== confirmDel.id));
          setConfirmDel(null);
        }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

// ---- Agents（智能体团队） ----

/** 智能体（团队成员）管理：卡片 grid，支持添加 / 修改 / 删除 */
function AgentSection() {
  // 团队按环境隔离：环境标签切换查看/编辑对应环境的分片（不影响左栏当前激活环境）
  const envs = useStore($environments);
  const engineEnvId = useStore($engineEnv).id;
  const [tab, setTab] = useState<string | null>(null);
  const viewEnv = tab ?? engineEnvId;
  const [list, setList] = useState<ConvItem[]>(() => loadAgentsOf(viewEnv));
  const refresh = useCallback(() => setList(loadAgentsOf(viewEnv)), [viewEnv]);
  useEffect(() => {
    setList(loadAgentsOf(viewEnv));
  }, [viewEnv]);

  const [agentModal, setAgentModal] = useState<null | { mode: "add" } | { mode: "edit"; agent: ConvItem }>(null);
  const [confirmDel, setConfirmDel] = useState<ConvItem | null>(null);
  const [tavernOpen, setTavernOpen] = useState(false);
  const teamImportRef = useRef<HTMLInputElement>(null);

  /** 导出当前标签环境的团队为 JSON（文件保存对话框选位置） */
  const exportTeam = async (): Promise<void> => {
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        defaultPath: `mirach-agents-${viewEnv}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const data = { version: 1, env: viewEnv, exportedAt: Date.now(), members: loadAgentsOf(viewEnv) };
      await invoke("write_user_file", { path, content: JSON.stringify(data, null, 2) });
    } catch (e) {
      window.alert("导出失败：" + String(e));
    }
  };

  /** 导入团队 JSON：成员按 id 合并进当前标签环境（已存在的不覆盖） */
  const importTeamFile = async (f: File | undefined): Promise<void> => {
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as { members?: ConvItem[] };
      if (!Array.isArray(data.members)) throw new Error("缺少 members 数组");
      const cur = loadAgentsOf(viewEnv);
      const ids = new Set(cur.map((a) => a.id));
      const merged = [...cur, ...data.members.filter((m) => m && m.id && !ids.has(m.id))];
      saveAgentsOf(viewEnv, merged);
      refresh();
    } catch (e) {
      window.alert("导入失败：" + String(e));
    }
  };

  const saveAgent = (data: {
    name: string;
    desc: string;
    avatarBg: string;
    systemPrompt?: string;
    model?: string;
    tools?: string[];
  }) => {
    if (agentModal?.mode === "edit" && agentModal.agent) {
      updateAgentIn(viewEnv, agentModal.agent.id, {
        name: data.name,
        desc: data.desc,
        avatarBg: data.avatarBg,
        systemPrompt: data.systemPrompt,
        model: data.model,
        tools: data.tools,
      });
    } else {
      addAgentIn(viewEnv, {
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

  return (
    <div>
      <SubHeading>智能体团队</SubHeading>
      <p className="px-5 py-2 text-body-sm text-muted-foreground">
        团队按环境隔离（聊天/代码/写作…各自独立）；左栏「成员」显示的是当前激活环境的团队。
      </p>

      {/* 环境标签：逐环境查看/编辑团队 */}
      <div className="flex flex-wrap items-center gap-1 px-5 pb-2">
        {envs.map((e) => (
          <button
            key={e.id}
            onClick={() => setTab(e.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              viewEnv === e.id
                ? "border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1]"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {e.name}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {/* 团队模板导入/导出（当前标签环境为单位） */}
          <button
            onClick={() => void exportTeam()}
            title="导出当前环境的团队为 JSON 文件"
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
      </div>

      <div className="px-5 pb-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {list.map((a) => (
            <div
              key={a.id}
              className="flex flex-col rounded-lg border border-black/10 bg-white p-3 shadow-sm transition-shadow hover:shadow-md"
            >
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

        {/* 酒馆角色接入（dsh-tavern）：固定导入到聊天环境，仅聊天标签显示 */}
        {viewEnv === TAVERN_MEMBER_ENV && (
          <button
            onClick={() => setTavernOpen(true)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#8B5CF6]/40 py-2 text-xs text-muted-foreground transition-colors hover:border-[#8B5CF6] hover:text-[#8B5CF6]"
          >
            <Users className="h-3.5 w-3.5" />
            导入酒馆角色（角色库 / 预设 / 角色卡）
          </button>
        )}
      </div>

      {tavernOpen && <TavernImportDialog onClose={() => setTavernOpen(false)} onImported={refresh} />}

      {agentModal && (
        <AgentEditModal
          agent={agentModal.mode === "edit" ? agentModal.agent : null}
          onClose={() => setAgentModal(null)}
          onSave={saveAgent}
        />
      )}

      <ConfirmDialog
        open={confirmDel !== null}
        title="删除智能体"
        description={"确定删除「" + (confirmDel?.name ?? "") + "」吗？其会话记录将保留。"}
        confirmLabel="删除"
        onConfirm={() => {
          if (confirmDel) removeAgentIn(viewEnv, confirmDel.id);
          setConfirmDel(null);
          refresh();
        }}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}

/** 智能体添加 / 编辑弹窗（名称 + 简介 + 头像色 + 系统提示词 + 模型 + 工具） */
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

        {/* 模型选择 */}
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-muted-foreground">使用模型</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="w-full rounded-md border border-border bg-white px-3 py-2 text-[12px] text-[#303030] outline-none transition-colors focus:border-[#6366F1]"
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
                  onClick={() =>
                    setTools((prev) => (checked ? prev.filter((x) => x !== tool) : [...prev, tool]))
                  }
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

        {/* 头像颜色 */}
        <div className="mt-3">
          <span className="mb-1 block text-[11px] text-muted-foreground">头像颜色</span>
          <div className="flex flex-wrap gap-1.5">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110"
                style={{ backgroundColor: c }}
                aria-label={"颜色 " + c}
              >
                {color === c && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!canSave}
            className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Usage（使用统计：dsh 引擎 token-meter 真实数据） ----

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function UsageContent() {
  const usage = useStore($usage);
  const totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.reasoningTokens;
  const cacheHit = usage.inputTokens > 0
    ? `${Math.round((usage.cacheReadTokens / usage.inputTokens) * 100)}%`
    : "—";
  // 上下文占用：最近一轮输入 tokens ≈ 当前对话上下文大小。
  // 分母 = 模型上下文窗口（1M 级）；压缩触发 ≈ 预算×0.8
  const ctxBudget = 1000000 * 0.8;
  const ctxPct = usage.lastInputTokens > 0
    ? Math.min(100, Math.round((usage.lastInputTokens / ctxBudget) * 100))
    : 0;
  return (
    <div className="p-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "引擎调用", value: String(usage.calls) },
          { label: "输入 tokens", value: fmtTokens(usage.inputTokens) },
          { label: "输出 tokens", value: fmtTokens(usage.outputTokens) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border p-3">
            <p className="text-[11px] text-muted-foreground">{s.label}</p>
            <p className="mt-1 text-subheading font-bold tabular-nums text-[#303030]">{s.value}</p>
          </div>
        ))}
      </div>

      {usage.lastInputTokens > 0 && (
        <div className="mt-4 rounded-lg border border-border p-4">
          <div className="flex items-center justify-between">
            <p className="text-body-sm font-medium text-[#303030]">当前对话上下文</p>
            <span className="text-[11px] font-mono text-muted-foreground">
              {fmtTokens(usage.lastInputTokens)} / ~{fmtTokens(Math.round(ctxBudget))}（{ctxPct}%）
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${ctxPct}%`,
                backgroundColor: ctxPct >= 80 ? "#EF4444" : ctxPct >= 50 ? "#F59E0B" : "#10B981",
              }}
            />
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">
            达到约 80 万 tokens 时引擎自动压缩历史（compaction-basic）
          </p>
        </div>
      )}

      <div className="mt-4 rounded-lg border border-border p-4">
        <p className="text-body-sm font-medium text-[#303030]">累计用量明细（跨启动持久累计）</p>
        <div className="mt-2 space-y-1.5 text-[12px] text-muted-foreground">
          <p>总计 tokens：<span className="font-mono text-[#303030]">{fmtTokens(totalTokens)}</span></p>
          <p>推理 tokens：<span className="font-mono text-[#303030]">{fmtTokens(usage.reasoningTokens)}</span></p>
          <p>缓存读取 tokens：<span className="font-mono text-[#303030]">{fmtTokens(usage.cacheReadTokens)}</span></p>
          <p>缓存命中率：<span className="font-mono text-[#303030]">{cacheHit}</span></p>
          <p className="pt-1 text-[11px]">数据来自 dsh 引擎 token-meter，跨启动累计；「清空统计」可归零</p>
        </div>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={() => resetUsage()}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
        >
          清空统计
        </button>
      </div>
    </div>
  );
}

// ---- About ----

const UNINSTALL_OPTIONS = [
  { id: "gui", label: "仅卸载桌面界面（Chat GUI）", desc: "保留 agent 与数据，可重新安装界面" },
  { id: "keep-data", label: "卸载界面 + agent，保留我的数据", desc: "数据目录不删除，可手动备份" },
  { id: "everything", label: "全部卸载", desc: "删除程序、配置、缓存与全部数据（不可恢复）" },
];

function AboutContent() {
  const { t } = useI18n();
  const [uninstallMode, setUninstallMode] = useState("gui");
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="space-y-4 px-5 py-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[#303030] text-xl font-bold text-white">M</div>
        <p className="text-subheading font-bold text-[#303030]">Mirach Harness</p>
        <p className="text-[11px] text-muted-foreground">奎木狼全能个人助理</p>
        <p className="text-body-sm text-muted-foreground">{t("settings.version")} v0.1.0</p>
      </div>
      <div className="rounded-lg border border-border p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
            <span className="text-body-sm font-medium text-[#303030]">{t("settings.latestVersion")}</span>
          </div>
          <span className="text-[11px] text-muted-foreground">{t("settings.lastChecked")}: today 09:00</span>
        </div>
        <div className="mt-3 flex gap-2">
          <button className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#464646]">{t("settings.checkNow")}</button>
          <button className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted">{t("settings.seeWhatsNew")}</button>
        </div>
      </div>
      <FieldRow label={t("settings.automaticUpdates")} hint="Branch main · Commit 8f3a2c1">
        <SwitchInput defaultOn />
      </FieldRow>

      {/* 卸载 */}
      <div className="rounded-lg border border-red-200 p-4">
        <p className="flex items-center gap-1.5 text-body-sm font-medium text-[#EF4444]">
          <Rocket className="h-4 w-4" strokeWidth={2} />
          {t("settings.uninstall")}
        </p>
        <div className="mt-2 space-y-1.5">
          {UNINSTALL_OPTIONS.map((o) => (
            <button
              key={o.id}
              onClick={() => setUninstallMode(o.id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left transition-colors",
                uninstallMode === o.id ? "border-[#EF4444] bg-red-50/60" : "border-border hover:bg-muted/40",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border",
                  uninstallMode === o.id ? "border-[#EF4444]" : "border-[#D1D5DB]",
                )}
              >
                {uninstallMode === o.id && <span className="h-1.5 w-1.5 rounded-full bg-[#EF4444]" />}
              </span>
              <span className="min-w-0">
                <span className="block text-body-sm text-[#303030]">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setConfirmOpen(true)}
          className="mt-3 flex items-center gap-1 rounded-md bg-[#EF4444] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#DC2626]"
        >
          <Trash2 className="h-3 w-3" strokeWidth={2} />
          确认卸载
        </button>
      </div>

      {/* 卸载确认 */}
      {confirmOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 backdrop-blur-md" onClick={() => setConfirmOpen(false)}>
          <div className="panel-glass popup-anim relative w-[380px] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-body-sm font-bold text-[#303030]">确认卸载？</h3>
            <p className="mt-2 text-body-sm leading-relaxed text-muted-foreground">
              {UNINSTALL_OPTIONS.find((o) => o.id === uninstallMode)?.label}
              {uninstallMode === "everything" && <span className="text-[#EF4444]">（数据不可恢复）</span>}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setConfirmOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
              >
                取消
              </button>
              <button
                onClick={() => {
                  setConfirmOpen(false);
                  window.alert(uninstallMode === "everything" ? "已启动完整卸载（演示）。" : `已启动卸载：${uninstallMode}（演示）。`);
                }}
                className="rounded-md bg-[#EF4444] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#DC2626]"
              >
                卸载
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- 主组件 ----

export function SettingsOverlay({ initialSection = "general", onClose }: { initialSection?: string; onClose?: () => void }) {
  const { t } = useI18n();
  const { reload } = useAppConfig();
  const [active, setActive] = useState(initialSection);
  const fileRef = useRef<HTMLInputElement>(null);

  // 导出配置 → 下载 config.json
  const exportConfig = async () => {
    try {
      const cfg = await invoke<Record<string, unknown>>("get_config");
      const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "hermes-config.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`导出失败：${String(e)}`);
    }
  };

  // 导入配置 → 解析 JSON → set_config 逐项写回（全字段，避免丢 apiBase/apiToken/hermesBin/dataDir）
  const importConfig = async (file: File) => {
    try {
      const obj = JSON.parse(await file.text()) as Record<string, unknown>;
      const str = (k: string): string | null => (typeof obj[k] === "string" ? (obj[k] as string) : null);
      await invoke("set_config", {
        workspace: str("workspace"),
        mirachHome: str("mirachHome"),
        browserHome: str("browserHome"),
        engineBase: str("engineBase"),
        apiBase: str("apiBase"),
        apiToken: str("apiToken"),
        hermesBin: str("hermesBin"),
        dataDir: str("dataDir"),
      });
      await reload();
      window.alert("配置已导入");
    } catch (e) {
      window.alert(`导入失败：${String(e)}`);
    }
  };

  // 恢复默认 → 删除 config.json
  const resetConfig = async () => {
    if (!window.confirm("恢复默认配置？当前自定义配置将被清除。")) return;
    try {
      await invoke("reset_config");
      await reload();
    } catch (e) {
      window.alert(`重置失败：${String(e)}`);
    }
  };

  const renderContent = () => {
    switch (active) {
      case "general": return <GeneralContent />;
      case "model": return <ModelContent onDone={onClose} />;
      case "plugins": return <PluginsContent />;
      case "presets": return <PresetsContent />;
      case "agents": return <AgentSection />;
      case "memory": return <MemorySection />;
      case "sessions": return <SessionsContent />;
      case "safety": return <SafetyContent />;
      case "git": return <GitContent />;
      case "keybinds": return <KeybindsContent />;
      case "usage": return <UsageContent />;
      case "envs": return <EnvSettingsSection />;
      case "about": return <AboutContent />;
      default: return null;
    }
  };

  return (
    <div className="settings-dropdown flex h-full">
      <div className="flex w-56 shrink-0 flex-col border-r border-border">
        <div className="min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => (
            <NavItem key={s.id} id={s.id} icon={s.icon} active={active === s.id} onClick={() => setActive(s.id)} />
          ))}
        </div>
        <div className="flex shrink-0 items-center justify-center gap-1 border-t border-border py-2">
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importConfig(f);
              e.target.value = "";
            }}
          />
          {[
            { icon: Download, title: t("settings.exportConfig"), run: () => void exportConfig() },
            { icon: Upload, title: t("settings.importConfig"), run: () => fileRef.current?.click() },
            { icon: RefreshCw, title: t("settings.resetToDefaults"), danger: true, run: () => void resetConfig() },
          ].map((b, i) => (
            <button
              key={i}
              title={b.title}
              onClick={b.run}
              className={cn(
                "flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted",
                b.danger && "hover:text-[#EF4444]",
              )}
            >
              <b.icon className="h-4 w-4" strokeWidth={2} />
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="px-5 py-3">
          <h3 className="text-member font-medium text-[#303030]">{t(`settings.${active}`)}</h3>
        </div>
        {renderContent()}
      </div>
    </div>
  );
}

function NavItem({ id, icon: Icon, active, onClick }: { id: string; icon: LucideIcon; active: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-body-sm transition-colors",
        active ? "bg-muted font-medium text-[#303030]" : "text-[#464646] hover:bg-muted/60",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
      <span className="truncate">{t(`settings.${id}`)}</span>
    </button>
  );
}

// ================================================================
// MemorySection — 环境记忆（per-env MEMORY.md / USER.md）
// 记忆文件 = <环境工作区>/.mirach/MEMORY.md（环境记忆）+ USER.md（用户档案）。
// sidecar 在 set_env 时把内容注入该环境全部对话（主对话 + 成员）的系统提示，
// AI 亦按注入的维护约定用文件工具自行更新。cwd 即环境边界 → 记忆天然按环境
// 隔离；工作区未设置的环境回退用户主目录。
// ================================================================

function MemorySection() {
  const envs = useStore($environments);
  const engineEnvId = useStore($engineEnv).id;
  const [tab, setTab] = useState<string | null>(null);
  const viewEnv = tab ?? engineEnvId;
  const env = envById(viewEnv);

  const [dir, setDir] = useState("");
  const [memory, setMemory] = useState("");
  const [user, setUser] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setNote("");
    void (async () => {
      const home = await userHomeDir();
      if (!alive) return;
      const base = env.cwd || home || "";
      setDir(base);
      const read = async (f: string): Promise<string> => {
        try {
          return await invoke<string>("read_file", { path: `${base}\\.mirach\\${f}` });
        } catch {
          return ""; // 文件不存在 = 还没有记忆
        }
      };
      const [m, u] = await Promise.all([read("MEMORY.md"), read("USER.md")]);
      if (!alive) return;
      setMemory(m);
      setUser(u);
      setLoaded(true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewEnv, env.cwd]);

  const save = async (): Promise<void> => {
    if (!dir) {
      setNote("无法确定工作区目录");
      return;
    }
    try {
      await invoke("write_user_file", { path: `${dir}\\.mirach\\MEMORY.md`, content: memory });
      await invoke("write_user_file", { path: `${dir}\\.mirach\\USER.md`, content: user });
      setNote("已保存 ✓（下一条消息起注入该环境的全部对话）");
    } catch (e) {
      setNote("保存失败：" + String(e));
    }
  };

  return (
    <div>
      <SubHeading>记忆</SubHeading>
      <p className="px-5 py-2 text-[11px] leading-relaxed text-muted-foreground">
        每个环境一份长期记忆，按环境标签切换。内容注入该环境全部对话（主对话与成员）的系统提示；
        AI 也会按约定把值得记住的信息写回这些文件。文件位置：
        <span className="ml-1 font-mono">{dir ? `${dir}\\.mirach\\` : "…"}</span>
      </p>

      {/* 环境标签 */}
      <div className="flex flex-wrap items-center gap-1 px-5 pb-2">
        {envs.map((e) => (
          <button
            key={e.id}
            onClick={() => setTab(e.id)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[11px] transition-colors",
              viewEnv === e.id
                ? "border-[#6366F1] bg-[#6366F1]/10 text-[#6366F1]"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {e.name}
          </button>
        ))}
      </div>

      <div className="space-y-3 px-5 pb-4">
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[#303030]">MEMORY.md — 环境记忆（项目事实 / 决策 / 约定）</span>
          <textarea
            value={memory}
            onChange={(e) => setMemory(e.target.value)}
            rows={10}
            placeholder={loaded ? "如：- 仓库用 pnpm，禁 npm\n- 部署目标是内网 192.168.x.x\n- 用户偏好中文回复" : "读取中…"}
            className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#303030] outline-none focus:border-[#6366F1]"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-medium text-[#303030]">USER.md — 用户档案（偏好 / 习惯 / 背景）</span>
          <textarea
            value={user}
            onChange={(e) => setUser(e.target.value)}
            rows={6}
            placeholder={loaded ? "如：- 称呼：H 总\n- 时区 Asia/Shanghai\n- 回复要结论先行" : "读取中…"}
            className="w-full resize-y rounded-md border border-border bg-white px-3 py-2 font-mono text-[12px] leading-relaxed text-[#303030] outline-none focus:border-[#6366F1]"
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          {note && <span className="text-[11px] text-[#10B981]">{note}</span>}
          <button
            onClick={() => void save()}
            disabled={!loaded}
            className="rounded-md bg-[#017CF3] px-3 py-1 text-xs text-white transition-colors hover:bg-[#017CF3]/90 disabled:opacity-50"
          >
            保存记忆
          </button>
        </div>
      </div>
    </div>
  );
}

// 角色卡行（角色库/在线市场共用）：头像+名字+分类+说明 + 修改（展开人设草稿）+ 导入
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
// TavernImportDialog — 导入酒馆角色（角色库 / 在线市场 / 酒馆预设 / 角色卡文件）

function TavernImportDialog({ onClose, onImported }: { onClose: () => void; onImported?: () => void }) {
  // 四个来源：角色库（前端内置）/ 在线市场（远程角色包，可加自定义源）/
  // 酒馆预设（dsh-tavern 插件目录）/ 角色卡文件（SillyTavern V2/V3 JSON）。
  // 统一导入为聊天环境成员（幂等 upsert）。
  const [tab, setTab] = useState<"gallery" | "market" | "presets" | "file">("gallery");
  // 已导入标记从聊天环境分片读取（酒馆成员固定放聊天环境，与当前激活环境无关）
  const [importedIds, setImportedIds] = useState<Set<string>>(
    () => new Set(loadAgentsOf(TAVERN_MEMBER_ENV).filter((a) => a.source === "tavern").map((a) => a.id)),
  );
  const [presets, setPresets] = useState<TavernPreset[] | null>(null);
  const [rootPath, setRootPath] = useState("");
  const [note, setNote] = useState("");
  // 角色库人设编辑草稿：key → 草稿（存在 = 展开编辑态）
  const [editing, setEditing] = useState<Record<string, string>>({});
  // 角色库筛选：分类 + 搜索
  const [cat, setCat] = useState<string>("全部");
  const [query, setQuery] = useState("");
  // 拖拽导入视觉态
  const [dragOver, setDragOver] = useState(false);
  // 在线市场：源列表 / 当前源 / 包缓存 / 拉取状态 / 自定义源表单
  const [sources, setSources] = useState<MarketSource[]>(() => allSources());
  const [marketUrl, setMarketUrl] = useState<string>(DEFAULT_MARKET_SOURCES[0]!.url);
  const [packCache, setPackCache] = useState<Record<string, MarketCacheEntry>>(() => loadCache());
  const [marketBusy, setMarketBusy] = useState(false);
  const [newSrc, setNewSrc] = useState({ name: "", url: "" });

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

  // tavern-lite（插件自带的空白基础预设，会被插件自动重建）没有任何角色人设，
  // 导入无价值——在导入列表中永久过滤
  const visiblePresets = (presets ?? []).filter((p) => p.key !== "tavern-lite");

  // ---- 在线市场 ----
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
  // 首次切到在线市场且默认源无缓存时自动拉取
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
    importMember(
      p.key,
      p.name,
      presetToPersona(p),
      p.description || "酒馆角色 · 预设 " + p.key,
      p.key, // 预设 id（=目录名）：成员会话空白期绑定，点亮世界书/记忆/关系网/剧情选项
    );
  };

  /** 导入文件（拖拽/选择共用）：PNG 角色卡（tEXt chara 块）+ SillyTavern JSON 卡 */
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

  /** 原生文件对话框选角色卡（PNG + JSON，默认打开用户主目录；Tauri dialog 插件） */
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
            importMember(
              card.name,
              card.name,
              cardToPersona(card),
              "PNG 角色卡" + (card.scenario ? " · " + card.scenario.slice(0, 24) : ""),
            );
            ok += 1;
          } else if (/\.json$/i.test(path)) {
            const text = await invoke<string>("read_file", { path });
            const card = parseCharacterCard(text);
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
          /* 单个文件读取失败：跳过 */
        }
      }
      setNote(ok > 0 ? "已导入 " + ok + " 个角色成员（聊天环境）" : "没有可识别的角色卡（支持 SillyTavern PNG / JSON）");
    } catch (e) {
      setNote("无法打开文件选择器：" + String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40" onClick={onClose}>
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

        {/* 来源切换：角色库 / 在线市场 / 酒馆预设 / 角色卡文件 */}
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

        {/* 来源一：角色库（前端内置，分类筛选 + 搜索，人设可先改） */}
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

        {/* 来源二：在线市场（远程角色包，可加自定义源） */}
        {tab === "market" && (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              从远程源拉取角色包（JSON 格式）。默认源 = mirach 仓库的角色包，仓库发版即更新；
              也可以添加自己的源（任何提供这种 JSON 的网址）。
            </p>
            {/* 源列表 */}
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
            {/* 添加自定义源 */}
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
            {/* 当前源的角色列表 */}
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

        {/* 来源三：酒馆预设目录（dsh-tavern 插件 ~/.dsh/.agent-presets） */}
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
                      <p className="truncate text-[12px] font-semibold text-[#303030]">
                        {p.name}
                      </p>
                      <p className="truncate text-[10px] text-muted-foreground">
                        {p.persona ? "persona 已就绪 · " + p.persona.slice(0, 40) : "无 persona（导入后为通用角色扮演提示词）"}
                      </p>
                    </div>
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

        {/* 来源三：角色卡文件（SillyTavern V2/V3 JSON，原生文件对话框） */}
        {tab === "file" && (
          <div className="mt-3">
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              导入 SillyTavern 格式的角色卡 JSON（V2/V3）。文件从哪来：SillyTavern 里导出的角色、
              角色分享社区/网站下载的卡，或照下面的最小结构自己写一份（字段都可以只填想要的）：
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
