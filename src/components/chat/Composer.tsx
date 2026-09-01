/**
 * Composer — 输入框区（输入框 + 底部工具行）
 *
 * ┌──────────────────────────────────────────────────────┐
 * │  textarea（自适应高度，Enter 发送）                    │
 * │  [+ 添加] [🛡]  [ⓖ] [🧠] [🤖] [🔊] [👂] [🎤] [▲]   │
 * └──────────────────────────────────────────────────────┘
 *
 * - 主按钮状态机（参考 hermes-agent-main 桌面版）：
 *   空输入 → 语音对话 (AudioLines) / 有文字 → 发送 (ArrowUp)
 *   busy+有文字 → 发送（连续发送，引擎串行消化）/ busy → 停止 (Square)
 * - 左下：+ 添加菜单（添加附件/文件夹/粘贴图片/附加 URL/提示词片段/使用提示）、
 *   模式切换（变更前确认/自动编辑/计划模式/完全访问）
 * - 右下：语音听写（模拟转写）、主按钮
 */

import { memo, useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { useHaptics } from "@/hooks/useHaptics";
import { invoke } from "@tauri-apps/api/core";
import { MOCK } from "@/lib/mock";
import { getApi, type ModelOption } from "@/lib/api";
import { appendSystemMessage, appendUserMessage, SESSION_ID, $autoSpeak, $currentAiId, $aiStreaming, finalizeAiMessage } from "@/store/chat";
import { kernelSend, kernelStop } from "@/dsh-kernel/boot";
import { $activeSessionId } from "@/store/session";
import { appendSessionUserMessage } from "@/store/session-chat";
import { $sessions } from "@/store/sessions";
import { useStreamingReply } from "@/hooks/useStreamingReply";
import { $busyMap, setAgentBusy, setSendHandler, sendMessage } from "@/store/agent";
import { $providerConfig, activeModelIdOf, setActiveModel, setActiveEffort, effectiveEffortOf } from "@/store/providerConfig";
import { $usage } from "@/store/usage";
import { $assemblyProjections } from "@/dsh-assembly/store";
import { $enterBehavior } from "@/store/ui-settings";
import { enqueue, parkQueuedPrompts, drainFirst, $queueState } from "@/store/queue";
import { NativeModelSeat, useNativeModelSeat } from "./NativeModelSeat";
import { $planActive, $permissionPreset, applyNativeMode, warmNativeModes, FULL_ACCESS_PRESET } from "@/lib/native-mode";
import { QueueBar } from "./QueueBar";
import {
  ArrowUp,
  AudioLines,
  Bot,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardPaste,
  Ear,
  EarOff,
  FileText,
  FolderOpen,
  Link2,
  ListTodo,
  Loader2,
  MessageSquareText,
  Mic,
  Paperclip,
  Plus,
  RefreshCw,
  Settings2,
  ShieldAlert,
  Square,
  SquareTerminal,
  StickyNote,
  Volume2,
  VolumeX,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

// ================================================================
// 模式配置（三种：计划模式 / 工作区编辑 / 完全访问，对应 dsh 权限三档）
// ================================================================

type AgentMode = "plan" | "workspace" | "full";

interface ModeConfig {
  id: AgentMode;
  label: string;
  desc: string;
  icon: LucideIcon;
}

const MODES: ModeConfig[] = [
  { id: "plan",      label: "计划模式",   desc: "只做分析规划，不修改任何文件", icon: ListTodo },
  { id: "workspace", label: "工作区编辑", desc: "自动批准对工作区文件的修改",   icon: Zap },
  { id: "full",      label: "完全访问",   desc: "完全访问权限，无需逐项确认",   icon: ShieldAlert },
];

// ================================================================
// 添加菜单项
// ================================================================

const PROMPT_SNIPPETS: { label: string; text: string }[] = [
  { label: "代码审查", text: "请审查以下代码，指出潜在问题并给出改进建议：" },
  { label: "重构建议", text: "请分析这段代码的重构机会，并给出具体方案：" },
  { label: "修复 Bug", text: "请帮我定位并修复这个 Bug，解释根因：" },
  { label: "编写测试", text: "请为下面的函数编写单元测试，覆盖边界情况：" },
  { label: "文档翻译", text: "请将以下内容翻译成英文，保持专业语气：" },
];

interface AddItem {
  label: string;
  icon: LucideIcon;
  sub?: { label: string; text: string }[];
}

const ADD_ITEMS: AddItem[] = [
  { label: "添加附件", icon: Paperclip },
  { label: "文件夹",   icon: FolderOpen },
  { label: "粘贴图片", icon: ClipboardPaste },
  { label: "附加 URL", icon: Link2 },
  { label: "提示词片段", icon: MessageSquareText, sub: PROMPT_SNIPPETS },
];

// ================================================================
// 模型目录（模拟 gateway model.options 返回，按供应商分组）
// ================================================================

// 真实模型列表 → 按供应商分组（relay_models 返回的 ModelOption[]）
// provider 名归一：sidecar catalog 的 id（deepseek 小写）与内置表（DeepSeek）
// 曾分裂成两组"多余 deepseek"——统一映射显示名后再分组
const PROVIDER_DISPLAY: Record<string, string> = {
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  google: "Google",
  gemini: "Gemini",
  xai: "xAI",
  engine: "引擎",
};
function providerDisplayName(p: string): string {
  return PROVIDER_DISPLAY[p.toLowerCase()] ?? (p.charAt(0).toUpperCase() + p.slice(1));
}
function realModelGroups(list: ModelOption[]): { provider: string; models: string[] }[] {
  const map = new Map<string, string[]>();
  list.forEach((m) => {
    const key = providerDisplayName(m.provider);
    const arr = map.get(key) ?? [];
    arr.push(m.id);
    map.set(key, arr);
  });
  return [...map.entries()].map(([provider, models]) => ({ provider, models }));
}

const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

// ================================================================
// 思考级别（左→右：关闭 → 超高）
// ================================================================

const EFFORT_LEVELS = ["关闭", "最低", "低", "中", "高", "超高"];
/** UI 六档 → 引擎五值（最低/低都映射 low；off 关闭思考） */
const DSHE_EFFORT = ["off", "low", "low", "medium", "high", "max"] as const;
/** 设置页 effort 值 → 滑块档位（未设置过=high——max 深思考把首包拖到十几秒，
 *  high 是速度/质量的默认平衡点；滑块可随时调回超高）。 */
const EFFORT_TO_INDEX = (v: string | undefined): number => {
  if (!v) return 4;
  const i = (DSHE_EFFORT as readonly string[]).indexOf(v);
  return i >= 0 ? i : 4;
};

/** 上下文组成三段（官方 contextBreakdown；颜色对齐官方 ContextMeter 图例） */
const CONTEXT_PARTS = [
  { key: "systemTokens" as const, label: "系统提示", color: "#6366F1" },
  { key: "toolsTokens" as const, label: "工具定义", color: "#F59E0B" },
  { key: "messageTokens" as const, label: "对话内容", color: "#10B981" },
];

// ================================================================
// 模型上下文信息（模拟 gateway model.info 返回）
// ================================================================

interface ModelInfo {
  context: string;
  cacheHit: string;
  price: string;
}

const MODEL_INFO: Record<string, ModelInfo> = {
  "gpt-4o":            { context: "128K", cacheHit: "82%", price: "$2.50 / $10.00" },
  "gpt-4o-mini":       { context: "128K", cacheHit: "85%", price: "$0.15 / $0.60" },
  "o3":                { context: "200K", cacheHit: "—",  price: "$10.00 / $40.00" },
  "o4-mini":           { context: "200K", cacheHit: "—",  price: "$1.10 / $4.40" },
  "claude-3.5-sonnet": { context: "200K", cacheHit: "80%", price: "$3.00 / $15.00" },
  "claude-3.7-sonnet": { context: "200K", cacheHit: "80%", price: "$3.00 / $15.00" },
  "deepseek-v3.2":     { context: "128K", cacheHit: "90%", price: "$0.28 / $0.42" },
  "deepseek-r1":       { context: "128K", cacheHit: "88%", price: "$0.55 / $2.19" },
};

function modelInfo(id: string): ModelInfo {
  const base = id.slice(id.lastIndexOf("/") + 1);
  return MODEL_INFO[base] ?? { context: "128K", cacheHit: "87%", price: "—" };
}

// ================================================================
// 上下文用量分解（模拟）
// pct 为占"当前已用容量"的百分比（如已用 50% 时技能 1.2% = 已用中的 1.2%），
// 合计 100%；color 与右侧栏用量面板的分类颜色一致（消息/系统工具/MCP/技能/系统提示词/其他）
// ================================================================


// "128K" / "1M" → token 数
function parseTokens(s: string): number {
  const m = s.match(/^([\d.]+)([KM])?$/);
  if (!m) return 128_000;
  const n = parseFloat(m[1]);
  return m[2] === "K" ? n * 1000 : m[2] === "M" ? n * 1_000_000 : n;
}

// token 数 → 紧凑显示（123000 → "123K"）
function compactTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return Math.round(n / 1000) + "K";
  return String(n);
}

// ================================================================
// 上下文容量仪表图标：12 点固定刻度线 + 随容量转动的指针
// ================================================================

function ContextGaugeIcon({ pct, className }: { pct: number; className?: string }) {
  // 指针角度：0% → 8 点方向 (210°)，100% → 12 点方向 (270°)
  const deg = ((210 + Math.min(100, Math.max(0, pct)) * 0.6) * Math.PI) / 180;
  const x = 12 + 7 * Math.cos(deg);
  const y = 12 + 7 * Math.sin(deg);
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      className={className ?? "h-4 w-4"}
    >
      <circle cx="12" cy="12" r="9" />
      {/* 12 点固定刻度线 */}
      <line x1="12" y1="3" x2="12" y2="12" />
      {/* 随容量转动的指针 */}
      <line x1="12" y1="12" x2={x} y2={y} />
    </svg>
  );
}

// 美化模型名（参考桌面版 model-status-label）：
// 去 provider 前缀、提取 Fast/Thinking 等灰标签、去日期后缀、破折号转空格标题化
function displayModelName(id: string): { name: string; tag?: string } {
  const base = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  let name = base;
  let tag: string | undefined;
  for (const [suffix, label] of [
    ["-fast", "Fast"],
    ["-thinking", "Thinking"],
    ["-preview", "Preview"],
    ["-latest", "Latest"],
  ] as const) {
    if (name.endsWith(suffix)) {
      tag = label;
      name = name.slice(0, -suffix.length);
      break;
    }
  }
  name = name.replace(/-\d{8}$/, "");
  let pretty: string;
  if (name.startsWith("gpt-")) {
    pretty = "GPT-" + name.slice(4);
  } else if (name.startsWith("gemini-")) {
    pretty = "Gemini " + name.slice(7).split("-").map(capitalize).join(" ");
  } else {
    pretty = name.split("-").map(capitalize).join(" ");
  }
  return { name: pretty, tag };
}

// ================================================================
// 使用提示（输入框内快捷用法）
// ================================================================

const HINT_LINES: { key: string; desc: string }[] = [
  { key: "@", desc: "以内联引用文件" },
  { key: "#", desc: "以内联引用对话" },
  { key: "/", desc: "打开命令面板" },
];

// ================================================================
// 按钮样式（参考 hermes-agent-main 桌面版 composer）
// ================================================================

// 主按钮：26px 圆形实心（亮色模式黑底白字）
const PRIMARY_ICON_BTN =
  "flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full " +
  "bg-foreground text-background transition-colors hover:bg-foreground/90 " +
  "disabled:bg-foreground/30 disabled:text-background disabled:opacity-100";

// 幽灵按钮：24px 圆角矩形
const GHOST_ICON_BTN =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md " +
  "text-muted-foreground hover:bg-muted hover:text-[#303030] transition-colors";

// 菜单项通用样式
const MENU_ITEM_BTN =
  "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] " +
  "hover:bg-muted transition-colors";

// ================================================================
// 组件
// ================================================================

interface ComposerProps {
  terminalOpen?: boolean;
  onToggleTerminal?: () => void;
  /** 发送回调（成员对话等外部接管发送；不传则保持内部模拟） */
  onSend?: (text: string) => void;
  /** 本地独立模式：发送只走 onSend，不写主对话 store、不流式提交（辅助对话等临时会话用） */
  standalone?: boolean;
  /** 简约档：输入外壳套用 zosma 玻璃样式（composer-glass），图标与逻辑不变，只换 ui */
  glass?: boolean;
  /** 官方模型/模式接线的目标会话（成员会话 member-<id> 等；缺省 = 活跃会话） */
  sessionScope?: string;
}

// memo：props 不变时跳过重渲染（列拖拽等父级宽度变化不应重渲染这个很重的组件）
export const Composer = memo(function Composer({ terminalOpen = false, onToggleTerminal, onSend, standalone = false, glass = false, sessionScope }: ComposerProps) {
  const { trigger } = useHaptics();
  // 流式回复消费（真实模式经 Tauri Channel；事件 → 聊天区增量写入）
  const streamReply = useStreamingReply();
  // 输入文本由 ref 持有（textarea 非受控）：输入不触发 React 重渲染——
  // Composer 是重组件，受控 textarea 每 keypress 全量重渲染是打字卡顿的来源
  const textRef = useRef("");
  // 忙碌按会话分桶（store/agent）：读"活跃会话"的忙——A 会话回复中，B 会话不受影响
  const busyMap = useStore($busyMap);
  const activeSid = useStore($activeSessionId);
  const busy = !!busyMap[activeSid ?? ""];
  // 真实模式 AI 是否流式中（驱动 placeholder/转向意图）：
  // busy 但未流式 = 已发送等首包（此时允许继续发送）；流式中主按钮=停止
  const streaming = useStore($aiStreaming);
  const sessionsAll = useStore($sessions);
  // 繁忙时 Enter 键行为（设置-通用设置）：queue=排队发送 / steer=插话发送
  const enterBehavior = useStore($enterBehavior);

  // 注册发送处理器（auto-drain 通过此回调触发发送）
  useEffect(() => {
    setSendHandler((msg: string) => {
      onSend?.(msg);
      if (standalone) return; // 独立模式：写入交给外部 onSend
      if (MOCK) {
        // mock：用户消息追加到当前会话 + 模拟 2.5s busy
        const sid = $activeSessionId.get();
        appendSessionUserMessage(sid, msg);
        setAgentBusy(true, sid);
        window.setTimeout(() => setAgentBusy(false, sid), 2500);
      } else {
        // 真实：写入用户消息 → 经 Channel 流式提交（附件拼进提示词）
        appendUserMessage(msg);
        void streamReply(SESSION_ID, buildPrompt(msg)).catch((e: unknown) =>
          appendSystemMessage(`⚠️ 提交失败：${String(e)}`),
        );
        // 发送后清空附件（与 handleSend 一致），避免排队退款/auto-drain 带旧附件
        setAttachments([]);
      }
    });
    return () => setSendHandler(null);
  }, [onSend, standalone]);
  const [mode, setMode] = useState<AgentMode>("workspace");
  // ── 官方接线：模型 seat（VITE_KERNEL=1 时官方 ModelSelect 组件）+ 模式命令 ──
  // 模式状态官方推导：plan/mode 投影事件 > 权限预设（danger-full-access=完全访问）
  // > 标准；内核不可用（mock/VITE_KERNEL=0）回退本地 mode 状态。
  const seat = useNativeModelSeat();
  const planActive = useStore($planActive);
  const permPreset = useStore($permissionPreset);
  const effMode: AgentMode = seat
    ? planActive ? "plan" : permPreset === FULL_ACCESS_PRESET ? "full" : "workspace"
    : mode;
  useEffect(() => {
    if (!MOCK) warmNativeModes();
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [snippetOpen, setSnippetOpen] = useState(false);
  const [menuView, setMenuView] = useState<"main" | "hints">("main");
  const [voiceActive, setVoiceActive] = useState(false);
  const [dictationActive, setDictationActive] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // 设置页「模型」区 → 输入框模型同步：设置改模型，输入框跟随；
  // 输入框选择模型也会写回设置（setActiveModel），引擎（dsh/real 目录）按设置模型跑
  const configs = useStore($providerConfig);
  const activeModel = useMemo(() => {
    const cfg = configs.find((c) => activeModelIdOf(c) !== "");
    return cfg ? activeModelIdOf(cfg) : "";
  }, [configs]);
  // 初值即取设置页当前模型（不写死旧占位）；未配置任何模型时为空（显示占位）
  const [model, setModel] = useState(() => {
    const cfg = $providerConfig.get().find((c) => activeModelIdOf(c) !== "");
    return cfg ? activeModelIdOf(cfg) : "";
  });
  useEffect(() => {
    if (activeModel && activeModel !== model) setModel(activeModel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModel]);
  const [modelOpen, setModelOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  // 模型下拉高度钳制（参考 zosma recalcPosition：按窗口上边界，避免小窗口点不到末项）
  const [modelDropH, setModelDropH] = useState(240);
  const modelBtnRef = useRef<HTMLButtonElement>(null);
  // 引擎目录拉取（轻量）：打开下拉时也会重拉，保证与引擎侧最新一致
  const pullRealModels = () => {
    void getApi()
      .getDSHModels()
      .then((models) => {
        if (models.length > 0) setRealModels(models);
      })
      .catch(() => {});
  };
  const openModelMenu = () => {
    setModelOpen((v) => !v);
    setAddOpen(false);
    setModeOpen(false);
    setModelQuery("");
    pullRealModels();
    window.requestAnimationFrame(() => {
      const btn = modelBtnRef.current;
      if (btn) setModelDropH(Math.max(140, Math.min(240, btn.getBoundingClientRect().top - 16)));
    });
  };
  // 模型目录：设置页 $providerConfig 是唯一实时真相源（改完立即出现）；
  // sidecar get_models 只做补充/对齐（内置目录、名称），不反向遮蔽设置页
  const [realModels, setRealModels] = useState<ModelOption[] | null>(null);

  useEffect(() => {
    if (MOCK) return;
    pullRealModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs]);

  const refreshModels = async () => {
    setRefreshing(true);
    try {
      const models = await getApi().getDSHModels();
      if (models.length > 0) setRealModels(models);
    } catch {
      /* 拉取失败保留现有列表 */
    } finally {
      setRefreshing(false);
    }
  };
  // 设置页已配置的模型（统一配置源；dsh 引擎目录 = 内置 deepseek + 这些提供商）
  const configModels: ModelOption[] = useMemo(() => {
    const list: ModelOption[] = [];
    for (const c of configs) {
      for (const m of c.models ?? []) {
        list.push({ id: m.id, provider: c.name ?? c.id, label: m.name ?? m.id });
      }
    }
    return list;
  }, [configs]);
  // 目录并集（id 去重，设置页配置优先）：只显示用户真实配置的模型——
  // 未配置时下拉为空（不再内置 deepseek 兜底，引擎目录也不并入，避免
  // "我明明什么都没配却出现 DeepSeek"的假象）
  const catalogModels: ModelOption[] = useMemo(() => {
    const seen = new Set<string>();
    const list: ModelOption[] = [];
    const push = (m?: ModelOption) => {
      if (m && m.id && !seen.has(m.id)) {
        seen.add(m.id);
        list.push(m);
      }
    };
    for (const m of configModels) push(m);
    if (configModels.length > 0 && realModels) for (const m of realModels) push(m);
    return list;
  }, [configModels, realModels]);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  // 思考级别单一真相源 = 设置页 providerConfig.activeEffort（effectiveEffortOf）。
  // 初值即从设置反查档位；未设置过时显示 max——与引擎默认行为一致（此前 UI
  // 默认"中"而引擎跑 max，两处永远对不上）。设置变化时滑块跟随。
  const effortFromStore = useMemo(() => {
    const cfg = configs.find((c) => activeModelIdOf(c) !== "");
    return cfg ? effectiveEffortOf(cfg) : undefined;
  }, [configs]);
  const [effortIndex, setEffortIndex] = useState(() => EFFORT_TO_INDEX(effortFromStore));
  useEffect(() => {
    setEffortIndex(EFFORT_TO_INDEX(effortFromStore));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effortFromStore]);
  // sidecar 冷启动 effort 默认 max：挂载即把设置页当前值推送对齐（相同则无副作用）
  useEffect(() => {
    const effort = DSHE_EFFORT[EFFORT_TO_INDEX(effortFromStore)] ?? "max";
    try {
      void invoke("dsh_set_effort", { effort }).catch(() => {});
    } catch {
      /* 非 Tauri 环境忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [effortOpen, setEffortOpen] = useState(false);
  const effortRef = useRef<HTMLDivElement>(null);

  const toggleProvider = (p: string) =>
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  // ---- 思考级别滑块：按指针位置换算档位 ----
  const effortPct = (effortIndex / (EFFORT_LEVELS.length - 1)) * 100;
  const effortIndexFromX = (clientX: number) => {
    const el = effortRef.current;
    if (!el) return effortIndex;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left) / rect.width;
    const idx = Math.round(t * (EFFORT_LEVELS.length - 1));
    return Math.max(0, Math.min(EFFORT_LEVELS.length - 1, idx));
  };
  const handleEffortPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setEffortIndex(effortIndexFromX(e.clientX));
  };
  const handleEffortPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons > 0) setEffortIndex(effortIndexFromX(e.clientX));
  };
  // 推理强度 → dsh 引擎：松开滑块时写回设置页（真相源持久化）+ 下发引擎。
  // sidecar 延迟生效（diff 重启键），流式回答中拖动不会再杀掉当前回合
  const handleEffortPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const idx = effortIndexFromX(e.clientX);
    setEffortIndex(idx);
    const effort = DSHE_EFFORT[idx] ?? "max";
    try {
      setActiveEffort(effort);
      void invoke("dsh_set_effort", { effort }).catch(() => {});
    } catch {
      /* 非 Tauri 环境忽略 */
    }
  };
  const speakActive = useStore($autoSpeak);
  const [wakeActive, setWakeActive] = useState(false);
  // 工具行宽度足够时显示按钮文字（模式/模型/思考级别），不足时仅图标
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(false);

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const check = () => setShowLabels(el.clientWidth >= 460);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- 非受控 textarea 的三件套：程序化写值 / 函数式更新 / 自适应高度 ----
  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  };
  const setTextSync = (v: string) => {
    textRef.current = v;
    syncHasText(v);
    const el = textareaRef.current;
    if (el && el.value !== v) {
      el.value = v;
      autoResize(el);
    }
  };
  const setTextFn = (fn: (t: string) => string) => setTextSync(fn(textRef.current));

  // ---- Slash 命令（输入框以 "/" 开头时弹出候选；Enter 执行 / Tab 补全 / Esc 关闭） ----
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  // ---- @ 提及（输入 "@" 后弹出成员/会话候选；Enter 选择 / Esc 关闭） ----
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionQuery, setMentionQuery] = useState("");
  const caretRef = useRef(0);
  const MENTION_MEMBERS = [
    { id: "m1", name: "Alice Chen", desc: "前端工程师" },
    { id: "m2", name: "Bob Wang", desc: "后端工程师" },
    { id: "m3", name: "Carol Li", desc: "数据库工程师" },
    { id: "m4", name: "David Zhang", desc: "运维工程师" },
    { id: "m5", name: "Eva Liu", desc: "测试工程师" },
    { id: "m6", name: "Frank Wu", desc: "架构师" },
  ];
  const mentionCandidates = [
    ...MENTION_MEMBERS.map((m) => ({ id: m.id, label: m.name, desc: m.desc, kind: "成员" })),
    ...sessionsAll.filter((s) => !s.archived).map((s) => ({ id: s.id, label: s.title, desc: "会话", kind: "会话" })),
  ].filter((c) => !mentionQuery || c.label.toLowerCase().includes(mentionQuery));
  // 选中候选：用 "@名字 " 替换 "@query"（保留候选前后文本）
  const runMention = (c: { label: string; kind: string }) => {
    setMentionOpen(false);
    const caret = caretRef.current;
    const before = textRef.current.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1) return;
    const inserted = `@${c.label} `;
    const next = before.slice(0, atIdx) + inserted + textRef.current.slice(caret);
    setTextSync(next);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const pos = atIdx + inserted.length;
        el.setSelectionRange(pos, pos);
        autoResize(el);
      }
    });
    textareaRef.current?.focus();
  };
  // 解析输入：光标前最后一个 "@" 且其后无空白 → 打开提及菜单
  const updateMention = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx === -1 || /\s/.test(before.slice(atIdx + 1))) {
      setMentionOpen(false);
      return;
    }
    setMentionQuery(before.slice(atIdx + 1).toLowerCase());
    setMentionIndex(0);
    setMentionOpen(true);
  };
  interface SlashCommand {
    cmd: string;
    label: string;
    desc: string;
    /** 选中后填入的提示文本（无则清空输入触发 action） */
    insert?: string;
    action?: () => void;
  }
  const SLASH_COMMANDS: SlashCommand[] = [
    {
      cmd: "help", label: "显示使用提示", desc: "列出 @ # / 等快捷用法",
      action: () => { setAddOpen(true); setMenuView("hints"); setModeOpen(false); },
    },
    {
      cmd: "skills", label: "技能与工具", desc: "列出已启用的技能与 MCP 工具",
      insert: "请列出当前可用的技能和 MCP 工具：",
    },
    { cmd: "terminal", label: "展开终端", desc: "打开底部终端页", action: () => onToggleTerminal?.() },
    { cmd: "model", label: "选择模型", desc: "切换当前模型", action: () => setModelOpen(true) },
    { cmd: "effort", label: "思考级别", desc: "调整思考级别", action: () => setEffortOpen(true) },
    {
      cmd: "mode", label: "切换模式", desc: "计划模式 / 工作区编辑 / 完全访问",
      action: () => setModeOpen(true),
    },
    {
      cmd: "review", label: "代码审查", desc: "审查当前工作区改动",
      insert: "请审查当前工作区的改动，指出潜在问题：",
    },
    {
      cmd: "test", label: "编写测试", desc: "为函数编写单元测试",
      insert: "请为以下代码编写单元测试，覆盖边界情况：",
    },
  ];
  const slashQuery = textRef.current.startsWith("/") ? textRef.current.slice(1).trim().toLowerCase() : "";
  const slashMatches =
    slashQuery.length === 0
      ? SLASH_COMMANDS
      : SLASH_COMMANDS.filter(
          (c) =>
            c.cmd.includes(slashQuery) ||
            c.label.toLowerCase().includes(slashQuery) ||
            c.desc.toLowerCase().includes(slashQuery),
        );
  const runSlash = (cmd: SlashCommand) => {
    setSlashOpen(false);
    setSlashIndex(0);
    if (cmd.insert) {
      setTextSync(cmd.insert);
      textareaRef.current?.focus();
      return;
    }
    setTextSync("");
    cmd.action?.();
  };

  // 发送按钮联动：非受控输入不重渲染，hasText 单独用 state——
  // onInput 仅在 空↔非空 翻转时 setState（每次输入会话至多两次重渲染）
  const [hasTextState, setHasTextState] = useState(false);
  const syncHasText = (v: string): void => {
    setHasTextState(v.trim().length > 0);
  };
  const hasText = hasTextState;
  const modeCfg = MODES.find((m) => m.id === effMode)!;
  const ModeIcon = modeCfg.icon;

  // 上下文占用：优先官方 contextPressure 投影（dsh-assembly 折叠 = 最新请求
  // prompt 侧占用 + surface 增量重估 + request/context 路由容量，能响应压缩）；
  // 无投影（mock/尚无 usage 事件）回落 $usage 累计 + 模型目录容量。
  // $usage 累计值随请求次数单调增长，不等于当前占用，长会话必虚高——投影才是官方语义。
  const usageRec = useStore($usage);
  const assembly = useStore($assemblyProjections);
  const pressure = assembly.contextPressure;
  const info = modelInfo(model);
  const catalogTotal = parseTokens(info.context);
  const occupancyUsed = pressure ? (pressure.projectedTokens ?? pressure.pressureTokens) : undefined;
  const projected = occupancyUsed !== undefined;
  const breakdown = projected ? assembly.contextBreakdown : undefined;
  const ctxUsed = projected ? occupancyUsed : usageRec.inputTokens + usageRec.cacheReadTokens;
  const ctxTotal = pressure?.contextWindow ?? (projected ? 0 : catalogTotal);
  const hasUsage = projected ? ctxUsed > 0 : usageRec.calls > 0 && ctxUsed > 0;
  const ctxPct = hasUsage && ctxTotal ? Math.max(1, Math.min(100, Math.round((ctxUsed / ctxTotal) * 100))) : 0;
  const usageSegments = [
    { label: "输入", value: usageRec.inputTokens, color: "#6366F1" },
    { label: "缓存读", value: usageRec.cacheReadTokens, color: "#10B981" },
    { label: "推理", value: usageRec.reasoningTokens, color: "#F59E0B" },
    { label: "输出", value: usageRec.outputTokens, color: "#EC4899" },
  ].filter((s) => s.value > 0);
  const usageSum = usageSegments.reduce((a, b) => a + b.value, 0) || 1;

  // ---- 附件（粘贴图片/文件/长文本 → 输入框上方胶囊，参考原型 AttachmentPill） ----
  interface ComposerAttachment {
    id: number;
    kind: "image" | "file" | "text";
    label: string;
    detail?: string;
    previewUrl?: string;
    content?: string;
  }
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const attachSeq = useRef(0);
  // 拖放文件到输入框 → 附件（图片读 dataURL，其余文件胶囊）
  const [dragActive, setDragActive] = useState(false);
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    for (const file of Array.from(e.dataTransfer?.files ?? [])) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = () =>
          addAttachment({
            kind: "image",
            label: file.name || "拖入的图片",
            detail: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            previewUrl: String(reader.result),
          });
        reader.readAsDataURL(file);
      } else {
        addFileAttachment(file);
      }
    }
  };
  // 附件 ref 镜像：sendHandler 注册 useEffect 只依赖 onSend，闭包捕获首帧 buildPrompt，
  // 直接读 state 会拿到过期的空附件；经 ref 始终读到最新附件
  const attachmentsRef = useRef<ComposerAttachment[]>([]);
  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  const addAttachment = (a: Omit<ComposerAttachment, "id">) => {
    attachSeq.current += 1;
    setAttachments((prev) => [...prev, { ...a, id: attachSeq.current }]);
  };
  const removeAttachment = (id: number) =>
    setAttachments((prev) => prev.filter((a) => a.id !== id));

  // 非图片文件 → 附件：文本类（≤500KB）读内容并入提示词（[File: 内容]），
  // 其余只带文件名标记（避免二进制乱码 / 上下文爆炸）
  const addFileAttachment = (file: File) => {
    const label = file.name || "文件";
    const detail = `${Math.max(1, Math.round(file.size / 1024))} KB`;
    if (file.size <= 512 * 1024 && /text|json|xml|yaml|yml|md|ts|tsx|js|jsx|css|html|rs|py|sh|json5|toml|ini|log/i.test(file.type)) {
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result ?? "").slice(0, 20_000);
        if (content) {
          addAttachment({ kind: "file", label, detail, content });
          return;
        }
        addAttachment({ kind: "file", label, detail });
      };
      reader.readAsText(file, "utf8");
      return;
    }
    addAttachment({ kind: "file", label, detail });
  };

  // 附件拼进提示词（参考 zosma：[File: path] / [Image: dataUrl] / [Text: …] 区块）
  // 之前附件只显示不发送；现在随提示词一起交给引擎
  const buildPrompt = (base: string): string => {
    const blocks = attachmentsRef.current
      .map((a) => {
        if (a.kind === "image" && a.previewUrl) return `[Image: ${a.previewUrl}]`;
        if (a.kind === "file" && a.content) return `[File: ${a.content}]`;
        if (a.kind === "text" && a.content) return `[Text: ${a.content}]`;
        return null;
      })
      .filter((b): b is string => b !== null);
    return blocks.length > 0 ? blocks.join("\n") + "\n\n" + base : base;
  };

  // 接收网页元素选择结果（浏览器"选择网页元素加入聊天" → 直接进输入框附件）
  // 与文件浏览器"添加到对话"（mirach:composer-attach，kind=file）共用入口
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: string; label?: string; detail?: string; content?: string }>).detail;
      if (!detail) return;
      if (detail.kind === "file" && detail.content) {
        addAttachment({
          kind: "file",
          label: detail.label ?? "文件",
          detail: detail.detail,
          content: detail.content,
        });
        return;
      }
      if (!detail.content) return;
      addAttachment({
        kind: "text",
        label: detail.label ?? "网页元素",
        detail: detail.detail,
        content: detail.content,
      });
    };
    window.addEventListener("mirach:composer-attach", handler);
    return () => window.removeEventListener("mirach:composer-attach", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 粘贴处理：图片 → 图片胶囊；文件 → 文件胶囊；长文本（>300 字符）→ 文本胶囊；短文本照常插入
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const files = Array.from(e.clipboardData?.files ?? []);
    const images = items.filter((i) => i.kind === "file" && i.type.startsWith("image/"));
    const otherFiles = files.filter((f) => !f.type.startsWith("image/"));

    if (images.length > 0) {
      e.preventDefault();
      images.forEach((item) => {
        const file = item.getAsFile();
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () =>
          addAttachment({
            kind: "image",
            label: file.name || "粘贴的图片",
            detail: `${Math.max(1, Math.round(file.size / 1024))} KB`,
            previewUrl: String(reader.result),
          });
        reader.readAsDataURL(file);
      });
      return;
    }
    if (otherFiles.length > 0) {
      e.preventDefault();
      otherFiles.forEach((f) => addFileAttachment(f));
      return;
    }
    const plain = e.clipboardData?.getData("text/plain") ?? "";
    if (plain.trim().length > 300) {
      e.preventDefault();
      addAttachment({
        kind: "text",
        label: "粘贴的文本",
        detail: `${plain.length} 字符`,
        content: plain,
      });
    }
    // 短文本走默认粘贴行为
  };

  // ---- 发送：清空输入 + mock 模拟 2.5s busy；真实模式经 Relay 提交引擎。
  // busy 不再阻塞发送（用户需求 #6）：AI 未回包时连续发送，用户气泡立即
  // 乐观上屏，sidecar 队列串行消化；流式中主按钮仍是停止。 ----
  const handleSend = () => {
    if (!hasText) return;
    trigger("submit", "composer-send");
    const trimmed = textRef.current.trim();
      const prompt = buildPrompt(trimmed);
    onSend?.(trimmed);
    setTextSync("");
    setAttachments([]);
    if (standalone) return; // 独立模式：写入交给外部 onSend，不碰主对话 store
    if (MOCK) {
      // mock：用户消息追加到当前会话 + 模拟 2.5s busy
      const sid = $activeSessionId.get();
      appendSessionUserMessage(sid, trimmed);
      setAgentBusy(true, sid);
      window.setTimeout(() => setAgentBusy(false, sid), 2500);
    } else if (import.meta.env.VITE_KERNEL === "1") {
      // B 阶段 3a：官方内核发送（session.prompt 入队；回复经事件镜像渲染）。
      // 内核未就绪时自动回退 sidecar 管道——消息永不因内核状态丢失。
      appendUserMessage(trimmed);
      setAgentBusy(true, $activeSessionId.get() ?? undefined); // 发送即等待：思考指示立即出现
      void kernelSend(prompt).catch((e: unknown) => {
        console.warn("[composer] kernel send failed — falling back to sidecar pipe:", e);
        setAgentBusy(false, $activeSessionId.get() ?? undefined);
        appendSystemMessage(`ℹ️ 内核链未就绪（${String(e).slice(0, 400)}），本条已走 sidecar 管道发送`);
        void streamReply(SESSION_ID, prompt).catch((e2: unknown) =>
          appendSystemMessage(`⚠️ 提交失败：${String(e2)}`),
        );
      });
    } else {
      // 真实：写入用户消息 → 经 Channel 流式提交（附件拼进提示词）
      appendUserMessage(trimmed);
      setAgentBusy(true, $activeSessionId.get() ?? undefined); // 发送即等待：思考指示立即出现
      void streamReply(SESSION_ID, prompt).catch((e: unknown) =>
        appendSystemMessage(`⚠️ 提交失败：${String(e)}`),
      );
    }
  };

  const handleStop = () => {
    // 保留已流出的半成品（finalize 仅复位状态，不替换文本），复位流式/busy
    finalizeAiMessage($currentAiId.get());
    setAgentBusy(false, $activeSessionId.get() ?? undefined);
    // 内核模式：中断当前回合（session.cancel）
    if (import.meta.env.VITE_KERNEL === "1") void kernelStop();
    // 有排队消息时停车，防止 auto-drain 立即发送
    if ($queueState.get().items.length > 0) parkQueuedPrompts();
    // 注：引擎侧中止（acp_stop）无现成调用，前端先收尾；后续补 Rust 命令
  };

  // ---- 语音听写：Web Speech API 实时转写（浏览器不支持时回退模拟） ----
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const handleDictate = () => {
    if (dictationActive) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setDictationActive(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onstart: () => void;
        onresult: (e: { results: { length: number; [i: number]: { [j: number]: { transcript: string } } } }) => void;
        onend: () => void;
        onerror: () => void;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => unknown;
    };
    const SR = w.SpeechRecognition ?? (w as unknown as { webkitSpeechRecognition?: new () => never }).webkitSpeechRecognition;
    if (!SR) {
      // 回退：模拟转写
      setDictationActive(true);
      setTranscribing(true);
      window.setTimeout(() => {
        setTranscribing(false);
        setDictationActive(false);
        setTextFn((t) => (t ? t + " " : "") + "好的，我来处理这个任务。");
        textareaRef.current?.focus();
      }, 1200);
      return;
    }
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = false;
    rec.onstart = () => setDictationActive(true);
    rec.onresult = (e) => {
      const transcript = Array.from({ length: e.results.length }, (_, i) => e.results[i][0].transcript).join("");
      if (transcript) {
        setTextFn((t) => (t ? t + " " : "") + transcript);
      }
    };
    rec.onend = () => {
      setDictationActive(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => {
      setDictationActive(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = rec;
    rec.start();
    textareaRef.current?.focus();
  };

  // ---- 主按钮状态机 ----
  let primaryIcon: ReactNode;
  let primaryLabel: string;
  let onPrimary: () => void;
  if (busy && hasText) {
    // 连续发送（用户需求 #6）：AI 未回完时继续发，乐观上屏，引擎侧串行消化
    primaryIcon = <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />;
    primaryLabel = "发送";
    onPrimary = handleSend;
  } else if (busy) {
    // 已发送未回完（等首包/思考中/流式中）：停止图标随时可中断
    primaryIcon = <Square className="h-2.5 w-2.5" fill="currentColor" strokeWidth={2.5} />;
    primaryLabel = "停止";
    onPrimary = handleStop;
  } else if (voiceActive) {
    primaryIcon = <Square className="h-2.5 w-2.5" fill="currentColor" strokeWidth={2.5} />;
    primaryLabel = "结束语音对话";
    onPrimary = () => setVoiceActive(false);
  } else if (hasText) {
    primaryIcon = <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.5} />;
    primaryLabel = "发送";
    onPrimary = handleSend;
  } else {
    primaryIcon = <AudioLines className="h-3.5 w-3.5" strokeWidth={2.5} />;
    primaryLabel = "开始语音对话";
    onPrimary = () => setVoiceActive(true);
  }

  return (
    // 输入区：限宽居中（跟随设置-对话宽度：--chat-composer-max-width，zosma 同款；
    // 默认 852px）；窄容器（成员/辅助对话）本来就小于限宽，w-full 保持原宽不受影响
    <div className="mx-auto w-full px-5 shrink-0 flex flex-col pb-3" style={{ maxWidth: "var(--chat-composer-max-width, 852px)" }}>
      {/* 附件胶囊（粘贴图片/文件/长文本；在输入框上方独立一行） */}
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="group relative flex max-w-[224px] items-center gap-2 rounded-2xl border border-black/10 bg-black/[0.03] px-2 py-1.5 pr-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] transition-colors hover:border-black/20"
            >
              {/* 缩略图（图片斜放）/ 图标 */}
              <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black/5">
                {a.kind === "image" && a.previewUrl ? (
                  <img
                    src={a.previewUrl}
                    alt=""
                    className="h-full w-full -rotate-2 scale-[1.08] object-cover"
                  />
                ) : a.kind === "text" ? (
                  <StickyNote className="h-3.5 w-3.5 text-[#464646]" strokeWidth={2} />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-[#464646]" strokeWidth={2} />
                )}
              </span>
              {/* 文件名 + 副标题 */}
              <span className="min-w-0">
                <span className="block max-w-[130px] truncate text-[11px] font-medium leading-tight text-[#303030]">
                  {a.label}
                </span>
                {a.detail && (
                  <span className="block max-w-[130px] truncate text-[10px] leading-tight text-muted-foreground">
                    {a.detail}
                  </span>
                )}
              </span>
              {/* 移除（hover 浮现） */}
              <button
                onClick={() => removeAttachment(a.id)}
                title="移除附件"
                className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#303030] text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
              >
                <X className="h-2.5 w-2.5" strokeWidth={3} />
              </button>
            </span>
          ))}
        </div>
      )}
      {/* 输入外壳：默认档白底描边；简约档（glass）套用 zosma composer-glass 玻璃样式，
          图标与逻辑完全不变，只换 ui（聚焦高亮由 composer-glass:focus-within 提供） */}
      <div
        className={glass
          ? "composer-glass relative rounded-2xl px-3 pt-2 pb-1.5"
          : "relative rounded-xl border border-border bg-white px-3 pt-2 pb-1.5 transition-colors focus-within:border-[#303030]/30 focus-within:ring-2 focus-within:ring-[#303030]/10"}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
      >
        {/* 拖放高亮层 */}
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-[#6366F1]/60 bg-indigo-50/80 text-body-sm text-[#6366F1]">
            松开以添加附件
          </div>
        )}
        {/* Slash 命令候选（输入以 "/" 开头时出现；Enter 执行 / Tab 补全 / Esc 关闭） */}
        {slashOpen && (
          <div className="panel-glass menu-anim absolute bottom-full left-0 z-50 mb-1 w-80 overflow-hidden rounded-xl py-1">
            {slashMatches.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的命令</p>
            ) : (
              slashMatches.map((c, i) => (
                <button
                  key={c.cmd}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted",
                    i === slashIndex && "bg-muted",
                  )}
                  onMouseEnter={() => setSlashIndex(i)}
                  onClick={() => runSlash(c)}
                >
                  <span className="w-16 shrink-0 font-mono text-xs font-medium text-[#6366F1]">/{c.cmd}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm text-[#303030]">{c.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{c.desc}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {/* @ 提及候选（输入 "@" 后出现；Enter 选择 / Esc 关闭） */}
        {mentionOpen && (
          <div className="panel-glass menu-anim absolute bottom-full left-0 z-50 mb-1 w-80 overflow-hidden rounded-xl py-1">
            {mentionCandidates.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的成员或会话</p>
            ) : (
              mentionCandidates.map((c, i) => (
                <button
                  key={`${c.kind}-${c.id}`}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-muted",
                    i === mentionIndex && "bg-muted",
                  )}
                  onMouseEnter={() => setMentionIndex(i)}
                  onClick={() => runMention(c)}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white",
                      c.kind === "成员" ? "bg-[#6366F1]" : "bg-muted text-[#464646]",
                    )}
                  >
                    {c.kind === "成员" ? c.label.slice(0, 2).toUpperCase() : "#"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm text-[#303030]">{c.label}</span>
                    <span className="block truncate text-[10px] text-muted-foreground">{c.desc}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        )}
        {/* 语音对话中：声波动画 */}
        {voiceActive && (
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="flex h-3.5 items-end gap-[2px]">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-sm bg-[#F59E0B]"
                  style={{
                    height: 4,
                    animation: "equalizer 0.9s ease-in-out infinite",
                    animationDelay: `${i * 0.12}s`,
                  }}
                />
              ))}
            </span>
            <span className="text-xs text-muted-foreground">语音对话中… 点击 ⏹ 结束</span>
          </div>
        )}
        {/* 排队消息条（busy 时入队的消息直接显示在输入框上方） */}
        <QueueBar />
        <textarea
          ref={textareaRef}
          onChange={(e) => {
            const v = e.target.value;
            const caret = e.target.selectionStart ?? v.length;
            caretRef.current = caret;
            textRef.current = v;
            syncHasText(v);
            autoResize(e.target);
            // @ 提及：光标前有未闭合的 "@" → 打开候选（与 Slash 互斥）
            updateMention(v, caret);
            // Slash 命令：以 "/" 开头弹出候选，其余情况关闭
            if (v.startsWith("/")) {
              setSlashOpen(true);
              setSlashIndex(0);
            } else {
              setSlashOpen(false);
            }
          }}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            // ---- @ 提及菜单导航（优先于其余快捷键） ----
            if (mentionOpen && mentionCandidates.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setMentionIndex((i) => (i + 1) % mentionCandidates.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setMentionOpen(false);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runMention(mentionCandidates[Math.min(mentionIndex, mentionCandidates.length - 1)]);
                return;
              }
            }
            // ---- Slash 命令菜单导航（优先于其余快捷键） ----
            if (slashOpen && slashMatches.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIndex((i) => (i + 1) % slashMatches.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIndex((i) => (i - 1 + slashMatches.length) % slashMatches.length);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setSlashOpen(false);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                runSlash(slashMatches[Math.min(slashIndex, slashMatches.length - 1)]);
                return;
              }
              if (e.key === "Tab") {
                e.preventDefault();
                setTextSync("/" + slashMatches[Math.min(slashIndex, slashMatches.length - 1)].cmd + " ");
                setSlashIndex(0);
                return;
              }
            }
            // Ctrl+Shift+K：排空下一条（立即发送队首）
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === "K" || e.key === "k")) {
              e.preventDefault();
              const item = drainFirst();
              if (item) sendMessage(item.text);
              return;
            }
            // Ctrl+Enter：busy 时入队当前输入
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              if (busy && textRef.current.trim()) {
                e.preventDefault();
                enqueue(textRef.current.trim());
                setTextSync("");
                setAttachments([]);
              }
              return;
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const trimmed = textRef.current.trim();
              // 繁忙时 Enter：steer=插话转向（设置-通用设置可选）；
              // 默认直接连续发送（#6：乐观上屏，引擎侧串行消化，不再强制排队）
              if (busy || (!MOCK && streaming)) {
                if (trimmed) {
                  if (enterBehavior === "steer" && !MOCK && streaming) {
                    void getApi()
                      .steer(trimmed)
                      .then(() => appendSystemMessage(`⚡ 已发送转向：${trimmed}`))
                      .catch((err: unknown) => appendSystemMessage(`转向失败：${String(err)}`));
                    setTextSync("");
                    setAttachments([]);
                  } else {
                    handleSend();
                  }
                }
              } else {
                handleSend();
              }
            }
          }}
          rows={1}
          placeholder={
            !MOCK && streaming
              ? "AI 回复中… 输入转向指令，Enter 发送"
              : busy
                ? "AI 回复中… 可继续输入，Enter 连续发送"
                : "输入消息... (Enter 发送, Shift+Enter 换行)"
          }
          className="w-full resize-none bg-transparent text-body-sm leading-normal text-[#303030] placeholder:text-muted-foreground focus:outline-none"
          style={{ minHeight: 42, maxHeight: 120 }}
        />

        {/* 工具行（flex-1 占满可用宽度，保证宽度检测正确） */}
        <div ref={toolbarRef} className="mt-1 flex flex-1 items-center gap-0.5">
          {/* ---- 左：添加 + 模式 ---- */}
          <div className="relative flex items-center gap-0.5">
            <button
              className={GHOST_ICON_BTN}
              title="添加"
              onClick={() => { setAddOpen((v) => !v); setModeOpen(false); setMenuView("main"); }}
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
            </button>

            {/* 添加菜单 */}
            {addOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setAddOpen(false)} />
                <div className="panel-glass menu-anim absolute bottom-full left-0 z-40 mb-1 w-60 rounded-xl py-1">
                  {menuView === "main" ? (
                    <>
                      {ADD_ITEMS.map(({ label, icon: Icon, sub }) => (
                        <div
                          key={label}
                          className="relative"
                          onMouseEnter={() => sub && setSnippetOpen(true)}
                          onMouseLeave={() => sub && setSnippetOpen(false)}
                        >
                          <button
                            className={cn(MENU_ITEM_BTN, sub && snippetOpen && "bg-muted")}
                            onClick={() => setAddOpen(false)}
                          >
                            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                            <span className="flex-1">{label}</span>
                            {sub && (
                              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                            )}
                          </button>

                          {/* 二级菜单：提示词片段 */}
                          {sub && snippetOpen && (
                            <div className="panel-glass menu-anim absolute left-full top-0 z-50 ml-1 w-36 rounded-xl py-1">
                              {sub.map((s) => (
                                <button
                                  key={s.label}
                                  className={MENU_ITEM_BTN}
                                  onClick={() => {
                                    setTextSync(s.text);
                                    setAddOpen(false);
                                    setSnippetOpen(false);
                                    textareaRef.current?.focus();
                                  }}
                                >
                                  {s.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* 分隔线 */}
                      <div className="my-1 h-px bg-border" />

                      {/* 使用提示 */}
                      <button
                        className={MENU_ITEM_BTN}
                        onClick={() => setMenuView("hints")}
                      >
                        <CircleHelp className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                        <span className="flex-1">使用提示</span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                      </button>
                    </>
                  ) : (
                    <>
                      {/* 提示视图：返回 */}
                      <button className={MENU_ITEM_BTN} onClick={() => setMenuView("main")}>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 rotate-180 text-muted-foreground" strokeWidth={2} />
                        <span className="flex-1">使用提示</span>
                      </button>
                      <div className="my-1 h-px bg-border" />
                      {HINT_LINES.map((h) => (
                        <div key={h.key} className="flex items-center gap-2 px-3 py-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-xs font-bold text-[#303030]">
                            {h.key}
                          </span>
                          <span className="text-body-sm text-[#303030]">输入 {h.key} {h.desc}</span>
                        </div>
                      ))}
                      <div className="my-1 h-px bg-border" />
                      <p className="px-3 pb-1 pt-0.5 text-xs text-muted-foreground">
                        Enter 发送 · Shift+Enter 换行
                      </p>
                    </>
                  )}
                </div>
              </>
            )}

            {/* 模式按钮（宽度充足时显示模式名；完全访问选中时黄色警示） */}
            <button
              className={cn(
                GHOST_ICON_BTN,
                showLabels && "w-auto gap-1 px-1.5",
                effMode === "full" && "bg-[#F59E0B]/10 text-[#F59E0B]",
              )}
              title={`模式：${modeCfg.label}（${modeCfg.desc}）`}
              onClick={() => { setModeOpen((v) => !v); setAddOpen(false); }}
            >
              <ModeIcon className="h-4 w-4" strokeWidth={2} />
              {showLabels && <span className="text-xs">{modeCfg.label}</span>}
            </button>

            {/* 终端开关（展开/收起底部终端页） */}
            <button
              className={GHOST_ICON_BTN}
              title={terminalOpen ? "收起终端" : "展开终端"}
              onClick={onToggleTerminal}
            >
              <SquareTerminal className="h-4 w-4" strokeWidth={2} />
            </button>

            {/* 模式菜单 */}
            {modeOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setModeOpen(false)} />
                <div className="panel-glass menu-anim absolute bottom-full left-0 z-40 mb-1 w-60 rounded-xl py-1">
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = m.id === effMode;
                    return (
                      <button
                        key={m.id}
                        onClick={() => {
                          setModeOpen(false);
                          if (seat) {
                            // 官方接线：/plan on|off + /permission <preset>（引擎真实生效）
                            void applyNativeMode(m.id, sessionScope);
                          } else {
                            setMode(m.id);
                          }
                        }}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors",
                          active && "bg-muted",
                        )}
                      >
                        <Icon
                          className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-[#303030]" : "text-muted-foreground")}
                          strokeWidth={2}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={cn("block text-body-sm leading-tight text-[#303030]", active && "font-medium")}>
                            {m.label}
                          </span>
                          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                            {m.desc}
                          </span>
                        </span>
                        {active && (
                          <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#303030]" strokeWidth={2.5} />
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>

          {/* ---- 右：用量 / 思考级别 / 模型 / 朗读回复 / 唤醒词 / 听写 / 主按钮 ---- */}
          <div className="ml-auto flex items-center gap-0.5">
            {/* 用量（悬停显示详情，原上下文容量；颜色与右侧栏用量面板一致） */}
            <div className="group relative">
              <button className={GHOST_ICON_BTN} title="用量">
                <ContextGaugeIcon pct={ctxPct} />
              </button>
              <div className="pointer-events-none invisible absolute bottom-full right-0 z-50 mb-1.5 w-64 rounded-lg bg-white p-3 opacity-0 shadow-md transition-opacity group-hover:visible group-hover:opacity-100">
                <p className="text-xs font-medium text-[#303030]">
                  {displayModelName(model).name}
                </p>
                {/* 用量：真实 token-meter 累计 / 模型目录容量 */}
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{projected ? "上下文占用（下次请求预估）" : "用量（本会话累计）"}</span>
                  <span className="font-medium text-[#303030]">
                    {hasUsage
                      ? ctxTotal > 0
                        ? `${compactTokens(ctxUsed)} / ${compactTokens(ctxTotal)} (${ctxPct}%)`
                        : compactTokens(ctxUsed)
                      : "尚无调用"}
                  </span>
                </div>
                {/* 使用进度条：真实四段（输入/缓存读/推理/输出）按占比分配 */}
                <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  {hasUsage &&
                    usageSegments.map((s) => (
                      <div
                        key={s.label}
                        className="h-full transition-all"
                        style={{ width: `${(s.value / usageSum) * (ctxTotal > 0 ? Math.min(100, (ctxUsed / ctxTotal) * 100) : 100)}%`, backgroundColor: s.color }}
                      />
                    ))}
                </div>
                {/* 占比分解 + 调用次数 */}
                <div className="mt-2.5 space-y-1">
                  {hasUsage ? (
                    <>
                      {usageSegments.map((s) => (
                        <div key={s.label} className="flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 text-muted-foreground">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.label}
                          </span>
                          <span className="text-[#303030]">
                            {compactTokens(s.value)} · {Math.round((s.value / usageSum) * 100)}%
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between pt-1.5 text-xs">
                        <span className="text-muted-foreground">引擎调用次数</span>
                        <span className="text-[#303030]">{usageRec.calls}</span>
                      </div>
                    </>
                  ) : (
                    <p className="py-1 text-[11px] leading-relaxed text-muted-foreground">
                      发送消息后这里显示引擎 token-meter 上报的真实用量。
                    </p>
                  )}
                </div>
                {/* 上下文组成（官方 contextBreakdown 投影：启发式三段，仅投影模式下显示） */}
                {projected && breakdown && (
                  <div className="mt-2.5 space-y-1 border-t border-black/5 pt-2">
                    <p className="text-[10px] font-medium text-muted-foreground">上下文组成（近似）</p>
                    {CONTEXT_PARTS.map((part) => (
                      <div key={part.key} className="flex items-center justify-between text-xs">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: part.color }} />
                          {part.label}
                        </span>
                        <span className="text-[#303030]">{compactTokens(breakdown[part.key])}</span>
                      </div>
                    ))}
                  </div>
                )}
                {/* 缓存命中率 / 价格（置底） */}
                <div className="mt-2.5 space-y-1.5 pt-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">平均缓存命中率</span>
                    <span className="text-[#303030]">{info.cacheHit}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">输入 / 输出价格</span>
                    <span className="text-[#303030]">
                      {info.price === "—" ? "—" : `${info.price} /M`}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* 思考级别（宽度充足时显示级别文字；点击弹出滑动选择器） */}
            <div className="relative">
              <button
                className={cn(GHOST_ICON_BTN, showLabels && "w-auto gap-1 px-1.5")}
                title={`思考级别：${EFFORT_LEVELS[effortIndex]}`}
                onClick={() => { setEffortOpen((v) => !v); setModelOpen(false); setAddOpen(false); setModeOpen(false); }}
              >
                <Brain className="h-4 w-4" strokeWidth={2} />
                {showLabels && <span className="text-xs">级别：{EFFORT_LEVELS[effortIndex]}</span>}
              </button>

              {/* 思考级别选择器 */}
              {effortOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setEffortOpen(false)} />
                  <div className="panel-glass menu-anim absolute bottom-full right-0 z-40 mb-1 w-64 rounded-xl p-3">
                    <p className="mb-2.5 text-xs font-medium text-[#303030]">
                      思考级别：<span className="font-normal text-muted-foreground">{EFFORT_LEVELS[effortIndex]}</span>
                    </p>
                    {/* 滑块：点击 / 左右拖动选择 */}
                    <div
                      ref={effortRef}
                      className="relative h-5 cursor-pointer touch-none select-none"
                        onPointerDown={handleEffortPointerDown}
                        onPointerMove={handleEffortPointerMove}
                        onPointerUp={handleEffortPointerUp}
                    >
                      {/* 轨道 */}
                      <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
                      {/* 已选进度 */}
                      <div
                        className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/60"
                        style={{ width: `${effortPct}%` }}
                      />
                      {/* 档位刻度 */}
                      {EFFORT_LEVELS.map((_, i) => (
                        <span
                          key={i}
                          className="absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-border"
                          style={{ left: `${(i / (EFFORT_LEVELS.length - 1)) * 100}%` }}
                        />
                      ))}
                      {/* 滑块圆点 */}
                      <div
                        className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow-sm"
                        style={{ left: `${effortPct}%` }}
                      />
                    </div>
                    {/* 档位标签 */}
                    <div className="mt-1.5 flex justify-between text-[10px] text-muted-foreground">
                      {EFFORT_LEVELS.map((l, i) => (
                        <span key={l} className={cn(i === effortIndex && "font-medium text-[#303030]")}>
                          {l}
                        </span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 模型选择：官方 ModelSelect seat（内核可用时，官方目录+官方选型 RPC）；
                内核不可用回退 mirach 自有菜单（设置页 providerConfig 数据源） */}
            {seat ? (
              <NativeModelSeat locked={busy} sessionScope={sessionScope} />
            ) : (
            <div className="relative">
              <button
                ref={modelBtnRef}
                className={cn(GHOST_ICON_BTN, showLabels && "w-auto px-1.5")}
                title={model ? `模型：${displayModelName(model).name}` : "未配置模型——点开选择或编辑模型"}
                onClick={openModelMenu}
              >
                {showLabels ? (
                  <span className="max-w-28 truncate text-xs">
                    {model ? displayModelName(model).name : "未配置模型"}
                  </span>
                ) : (
                  <Bot className="h-4 w-4" strokeWidth={2} />
                )}
              </button>

              {/* 模型弹窗（参考桌面版 ModelMenuPanel） */}
              {modelOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setModelOpen(false)} />
                  <div className="panel-glass menu-anim absolute bottom-full right-0 z-40 mb-1 w-64 overflow-hidden rounded-xl">
                    {/* 搜索 + 刷新（真实模式从引擎拉取） */}
                    <div className="flex items-center border-b border-black/5">
                      <input
                        autoFocus
                        value={modelQuery}
                        onChange={(e) => setModelQuery(e.target.value)}
                        placeholder="搜索模型"
                        className="w-full bg-transparent px-3 py-2 text-xs text-[#303030] placeholder:text-muted-foreground focus:outline-none"
                      />
                      <button
                        onClick={() => void refreshModels()}
                        title="刷新模型"
                        className={cn(
                          "mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]",
                          refreshing && "animate-spin",
                        )}
                      >
                        <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>

                    {/* 供应商分组（组头可点击展开/折叠） */}
                    <div className="overflow-y-auto py-0.5" style={{ maxHeight: modelDropH }}>
                      {(() => {
                        const q = modelQuery.trim().toLowerCase();
                        const searching = q.length > 0;
                        const groups = realModelGroups(catalogModels)
                          .map((g) => ({
                            provider: g.provider,
                            models: searching
                              ? g.models.filter(
                                  (m) => m.toLowerCase().includes(q) || g.provider.toLowerCase().includes(q),
                                )
                              : g.models,
                          }))
                          .filter((g) => g.models.length > 0);
                        return groups.length === 0 ? (
                          <p className="px-3 py-2 text-xs text-muted-foreground">未找到模型</p>
                        ) : (
                          groups.map((g) => {
                            const collapsed = !searching && collapsedProviders.has(g.provider);
                            return (
                              <div key={g.provider}>
                                {/* 组头：点击折叠/展开 */}
                                <button
                                  className="flex w-full items-center gap-1 px-2.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-[#303030] transition-colors"
                                  onClick={() => toggleProvider(g.provider)}
                                >
                                  <ChevronDown
                                    className={cn("h-3 w-3 shrink-0 transition-transform", collapsed && "-rotate-90")}
                                    strokeWidth={2.5}
                                  />
                                  <span className="flex-1 text-left">{g.provider}</span>
                                </button>
                                {!collapsed &&
                                  g.models.map((m) => {
                                    const { name, tag } = displayModelName(m);
                                    const active = m === model;
                                    return (
                                      <button
                                        key={m}
                                        onClick={() => {
                                          setModel(m);
                                          const cfg = configs.find((c) => c.models.some((x) => x.id === m));
                                          if (cfg) setActiveModel(cfg.id, m);
                                          setModelOpen(false);
                                        }}
                                        className={cn(MENU_ITEM_BTN, active && "bg-muted")}
                                      >
                                        <span className="flex-1 truncate">{name}</span>
                                        {tag && (
                                          <span className="shrink-0 text-[10px] text-muted-foreground">{tag}</span>
                                        )}
                                        {active && (
                                          <Check className="h-3.5 w-3.5 shrink-0 text-[#303030]" strokeWidth={2.5} />
                                        )}
                                      </button>
                                    );
                                  })}
                              </div>
                            );
                          })
                        );
                      })()}
                    </div>

                    {/* 页脚 */}
                    <div className="py-0.5">
                      <button
                        className={MENU_ITEM_BTN}
                        onClick={() => void refreshModels()}
                      >
                        {refreshing ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" strokeWidth={2} />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                        )}
                        <span className="flex-1">刷新模型</span>
                      </button>
                      <button
                        className={MENU_ITEM_BTN}
                        onClick={() => {
                          setModelOpen(false);
                          // 直接进入设置 → 模型页（AppLayout 监听 detail.section）
                          window.dispatchEvent(
                            new CustomEvent("mirach:open-settings", { detail: { section: "model" } }),
                          );
                        }}
                      >
                        <Settings2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
                        <span className="flex-1">编辑模型…</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
            )}

            {/* 朗读回复 */}
            <button
              className={cn(GHOST_ICON_BTN, speakActive && "bg-[#F59E0B]/10 text-[#F59E0B]")}
              title={speakActive ? "关闭朗读回复" : "开启朗读回复"}
              onClick={() => $autoSpeak.set(!speakActive)}
            >
              {speakActive ? (
                <Volume2 className="h-4 w-4" strokeWidth={2} />
              ) : (
                <VolumeX className="h-4 w-4" strokeWidth={2} />
              )}
            </button>

            {/* 唤醒词 */}
            <button
              className={cn(GHOST_ICON_BTN, wakeActive && "bg-[#F59E0B]/10 text-[#F59E0B]")}
              title={wakeActive ? "关闭唤醒词" : "唤醒词（待接入 · hey hermes）"}
              onClick={() => setWakeActive((v) => !v)}
            >
              {wakeActive ? (
                <Ear className="h-4 w-4" strokeWidth={2} />
              ) : (
                <EarOff className="h-4 w-4" strokeWidth={2} />
              )}
            </button>

            {/* 听写 */}
            <button
              className={cn(GHOST_ICON_BTN, (dictationActive || transcribing) && "bg-primary/10 text-primary")}
              title={dictationActive ? "停止听写" : "语音听写"}
              onClick={handleDictate}
            >
              {transcribing ? (
                <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              ) : dictationActive ? (
                <Square className="h-3 w-3" fill="currentColor" strokeWidth={2} />
              ) : (
                <Mic className="h-4 w-4" strokeWidth={2} />
              )}
            </button>

            {/* 主按钮 */}
            <button
              className={PRIMARY_ICON_BTN}
              title={primaryLabel}
              onClick={onPrimary}
            >
              {primaryIcon}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
