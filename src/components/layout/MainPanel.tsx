/**
 * MainPanel — 主内容区
 *
 * ┌──────────────────────────────────┐
 * │  标题区 (85px)                    │
 * │  项目名称 + 简介                  │
 * ├──────────────────────────────────┤
 * │  对话内容区 (265px)               │
 * │  AI头像 + 人名 + 已工作X分钟 ▸    │
 * │  🧠 思考过程  12s          ▸     │
 * │  🔍 探索文件  8s           ▸     │
 * │  ✏️ 编辑文件  5s           ▸     │
 * │  ┌──────────────────────┐       │
 * │  │ 结果气泡              │       │
 * │  │ 悬停操作栏            │       │
 * │  └──────────────────────┘       │
 * ├──────────────────────────────────┤
 * │  输入框区 (265px)                 │
 * ├──────────────────────────────────┤
 * │  终端区 (flex-1, min 265px)       │
 * │  ───────── 20px 留白 ─────────   │
 * └──────────────────────────────────┘
 */

import { memo, useCallback, useMemo, useState, useRef, useEffect, Component, type MutableRefObject, type ReactNode } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
import { HeaderRule } from "@/components/layout/HeaderRule";
import { Composer } from "@/components/chat/Composer";
import { SessionTabs } from "@/components/session/SessionTabs";
import { TerminalPanel } from "@/components/chat/TerminalPanel";
import { StatusWindow } from "@/components/chat/status-stack/StatusWindow";
import { ToolEntry } from "@/components/chat/tool-call/ToolEntry";
import { DshToolRow } from "@/components/dsh/DshToolRow";
import { CompactionRow } from "@/components/dsh/CompactionRow";
import { UserQuestionCard } from "@/components/chat/UserQuestionCard";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import { ReasoningRow } from "@/dsh-ui/ReasoningRow.tsx";
import { useI18n } from "@/lib/i18n";
import { SystemMessage } from "@/components/chat/SystemMessage";
import { $toolCalls, type ToolCall } from "@/store/tool-calls";
import { setPreviewUrl } from "@/store/preview";
import { $pendingQuestions, setPendingQuestions, dropExpiredQuestions } from "@/store/user-questions";
import { $activeSessionId, setActiveSession } from "@/store/session";
import { $sessions, markSessionContent, setSessionsEnv, createSession } from "@/store/sessions";
import { pushRawEvents, resetRawEvents } from "@/store/session-events";
import { $projects, $selectedProjectId, createProject, selectProject } from "@/store/projects";
import { CircularGallery } from "@/components/ui/circular-gallery-2";
import { StatsLine } from "@/components/chat/StatsLine";
import { FileChangesRow } from "@/components/chat/FileChangesRow";
import { $sessionChat, getSessionChat, appendSessionAiMessage } from "@/store/session-chat";
import { openChatHistory, $jumpRequest, $showSessionTabs, toggleSessionTabs, $trajectoryRequest } from "@/store/chat-history";
import {
  $liveMessages,
  $aiStreaming,
  appendSystemMessage,
  loadLiveHistory,
  type LiveChatMessage,
  type DshToolCallInfo,
} from "@/store/chat";
import { getApi } from "@/lib/api";
import { invoke } from "@tauri-apps/api/core";
import { $providerConfig } from "@/store/providerConfig";
import { envById, envIdForView, $envVersion, $environments } from "@/store/environments";
import { CHAT_WIDTH_PX } from "@/lib/chat-width";
import { $chatBackdrop, $chatStyle, $chatWidth, $defaultAgent } from "@/store/ui-settings";
import { $agents, setAgentsEnv, DEFAULT_TEAM_ID } from "@/store/agents";
import { ZosmaChat } from "@/components/zosma/ZosmaChat";
import { speak, stopSpeaking, isSpeaking } from "@/lib/tts";
import { useQueueAutoDrain } from "@/hooks/useQueueAutoDrain";
import { $lastFailedPrompt, setLastFailedPrompt } from "@/store/retry";
import { sendMessage, $busyMap } from "@/store/agent";
import { useTodoAutoDismiss } from "@/hooks/useTodoAutoDismiss";
import { useBackgroundAutoDismiss } from "@/hooks/useBackgroundAutoDismiss";
import { useMockStatus } from "@/hooks/useMockStatus";
import { MOCK } from "@/lib/mock";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { CustomScrollbar } from "@/components/ui/CustomScrollbar";
import { TurnNavigator, type TurnNavigationItem, type TurnNavigatorT } from "@/components/chat/TurnNavigator";
import { TrajectoryOverlay } from "@/components/trajectory/TrajectoryOverlay";
import {
  ArrowDown,
  Boxes,
  GitFork,
  Code,
  Container,
  Copy,
  Database,
  Ellipsis,
  FileCode,
  GitBranch,
  Globe,
  MessagesSquare,
  PanelLeft,
  PenTool,
  RefreshCw,
  Clock,
  SquareTerminal,
  Volume2,
  Wrench,
  History,
  ListTodo,
  X,
  Rows3,
  ThumbsDown,
  ThumbsUp,
  Waypoints,
  Target,
  Pencil,
  Check,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { MagnifyingGlass, CaretDown } from "@phosphor-icons/react";
import { CommandPalette, type CommandPaletteAction } from "@/components/command-palette/CommandPalette";
import { ViewPage } from "@/pages/ViewPages";
import { $goalState, setGoal, clearGoal } from "@/store/goals";
import { $agentMode, setAgentMode } from "@/store/agent";

// ================================================================
// 工作状态类型
// ================================================================
// ActivityStep 已移除 — 思考过程改用 ThinkingDisclosure 组件
// 工具调用改用 ToolEntry 组件 + $toolCalls store

// ================================================================
// 已安装插件（图标显示在标题右侧；超出宽度时收进省略号弹窗）
// 数据源：plugins store（插件管理器可启停/安装/卸载），仅显示已启用
// ================================================================

import { $plugins } from "@/store/plugins";

interface PluginItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

// 插件 id → 图标映射（store 只存元数据，图标在前端映射）
const PLUGIN_ICONS: Record<string, LucideIcon> = {
  git: GitBranch,
  docker: Container,
  k8s: Boxes,
  database: Database,
  browser: Globe,
  ssh: SquareTerminal,
  python: FileCode,
  vscode: Code,
  slack: MessagesSquare,
  figma: PenTool,
};

function useInstalledPlugins(): PluginItem[] {
  const plugins = useStore($plugins);
  return plugins
    .filter((p) => p.enabled && PLUGIN_ICONS[p.id])
    .map((p) => ({ id: p.id, label: p.label, icon: PLUGIN_ICONS[p.id] }));
}

// 单个插件按钮占宽（24 图标 + 4 gap）
const PLUGIN_SLOT = 28;

// 顶部命令输入框的固定长度（px）
// 仅当插件区右侧空白 ≥ 输入框长度 + 40（两侧各 20px 间距）时才显示
const INPUT_WIDTH = 240;

// 顶部命令搜索控制器（搜索框输入 + 结果下拉，由 AppLayout 注入）
interface PaletteController {
  open: boolean;
  query: string;
  actions: CommandPaletteAction[];
  onQueryChange: (q: string) => void;
  onOpen: () => void;
  onClose: () => void;
}

// ================================================================
// 标题区
// ================================================================

function HeaderSection({
  width,
  showLeft,
  onExpandLeft,
  palette,
}: {
  width: number;
  showLeft: boolean;
  onExpandLeft: () => void;
  /** 顶部命令搜索控制器（搜索框输入 + 结果下拉） */
  palette?: PaletteController;
}) {
  // 标题块固定上限（CSS max-w-[320px]）：项目名与会话名都在其内截断，
  // 插件图标条位置稳定不受会话名长短影响
  // 标题 = 项目名（当前激活会话所属项目，匹配不到用第一个）；介绍 = 当前会话名
  const activeId = useStore($activeSessionId);
  const sessions = useStore($sessions);
  const projects = useStore($projects);
  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0];
  const sessionTitle = activeSession?.title ?? "新会话";
  const projectName =
    projects.find((p) => p.sessions.some((s) => s.title === sessionTitle))?.name ??
    projects[0]?.name ??
    "Mirach Harness Project";
  // 插件区总宽不超过容器总宽度的 1/4；个数按空间比例计算（1/4 宽度可放几个就显示几个）
  const PLUGINS = useInstalledPlugins();
  const pluginCap = Math.max(1, Math.floor((width * 0.25) / PLUGIN_SLOT));
  const visibleCount = Math.min(pluginCap, PLUGINS.length);
  const visiblePlugins = PLUGINS.slice(0, visibleCount);
  const pluginOverflow = PLUGINS.length > visibleCount;
  const [pluginsOpen, setPluginsOpen] = useState(false);

  // 插件区右侧的空白宽度（命令输入框是否显示的唯一依据）
  const headerRef = useRef<HTMLDivElement>(null);
  const pluginsRef = useRef<HTMLDivElement>(null);
  const [blankRight, setBlankRight] = useState(0);
  useEffect(() => {
    const headerEl = headerRef.current;
    const pluginsEl = pluginsRef.current;
    if (!headerEl || !pluginsEl) return;
    const measure = () => {
      // 空白 = 容器右边缘 − 插件区右边缘；不含输入框自身，故不会因显隐而抖动
      setBlankRight(headerEl.getBoundingClientRect().right - pluginsEl.getBoundingClientRect().right);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(headerEl);
    ro.observe(pluginsEl);
    return () => ro.disconnect();
  }, []);

  // 空白 ≥ 输入框长度 + 40（两侧各 20px 间距）才显示命令输入框
  const showSearch = blankRight >= INPUT_WIDTH + 40;

  // 搜索输入框 ref：命令面板打开时聚焦（⌘K / 下拉按钮触发）
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (palette?.open) inputRef.current?.focus();
  }, [palette?.open]);

  return (
    <div
      ref={headerRef}
      className="relative flex items-center px-5 shrink-0"
      style={{ height: 85 }}
    >
      {/* 顶部容器底部分割线（两端各留 15px 空白） */}
      <HeaderRule />
      {/* 左侧栏收起时显示展开按钮（z-20 高于 TopBar 的 z-10，避免被透明顶栏拦截点击） */}
      {!showLeft && (
        <button
          onClick={onExpandLeft}
          className="relative z-20 mr-3 flex h-8 w-8 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors shrink-0"
        >
          <PanelLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
      {/* ---- 标题：第一行 = 项目名 + 插件图标条（图标严格跟随项目名）；
           第二行 = 会话名（独立一行完整显示，不被图标截断） ---- */}
      <div className="flex min-w-0 flex-col gap-1 max-w-[520px]">
        <div className="flex min-w-0 items-center gap-3">
          <h2 title={projectName} className="truncate text-heading font-bold text-[#303030] leading-[1.4]">
            {projectName}
          </h2>
          {/* ---- 已安装插件区（随项目名排布；超出收省略号） ---- */}
          <div ref={pluginsRef} className="flex shrink-0 items-center">
            <div className="flex items-center gap-0.5 overflow-hidden">
              {visiblePlugins.map((p) => (
                <button
                  key={p.id}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                  title={p.label}
                  onClick={() => setPluginsOpen(false)}
                >
                  <p.icon className="h-4 w-4" strokeWidth={2} />
                </button>
              ))}
              {pluginOverflow && (
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                  title="更多插件"
                  onClick={() => setPluginsOpen((v) => !v)}
                >
                  <Ellipsis className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
        <p title={sessionTitle} className="truncate text-body-sm text-muted-foreground leading-none">
          {sessionTitle}
        </p>
      </div>

      {/* ---- 插件弹窗（省略号点击；锚定在标题区下方） ---- */}
      {pluginsOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPluginsOpen(false)} />
          <div className="panel-glass menu-anim absolute left-5 top-full z-40 mt-1 w-48 rounded-xl py-1">
            <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">已安装插件</p>
            {PLUGINS.map((p) => (
              <button
                key={p.id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                onClick={() => setPluginsOpen(false)}
              >
                <p.icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                <span className="flex-1">{p.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* ---- 空白区 + 一体式快捷搜索（位于插件右侧空白的正中间；空白不足时隐藏） ---- */}
      {showSearch ? (
        <>
          <div className="flex-1" />
          {/* 占位容器：固定搜索栏宽度，保证标题区 flex 布局不跳动 */}
          <div className="relative z-50 shrink-0" style={{ width: INPUT_WIDTH, height: 32 }}>
            {/* 一体卡片（dropdown-card 令牌，与左侧栏「已置顶会话」同款）：
                absolute 覆盖占位区 → 展开时只向下延伸（不挤布局、不向上冒）；
                宽度恒等于搜索栏；打开时 borderTop 分隔出结果区，一体展开无弹窗感 */}
            <div className="dropdown-card absolute left-0 top-0" style={{ width: INPUT_WIDTH }}>
              <div className="flex items-center">
                <MagnifyingGlass className="ml-3 h-4 w-4 shrink-0 text-muted-foreground" weight="bold" />
                <input
                  ref={inputRef}
                  value={palette?.query ?? ""}
                  placeholder="Ctrl+K 快捷搜索"
                  onChange={(e) => {
                    palette?.onQueryChange(e.target.value);
                    if (!palette?.open) palette?.onOpen();
                  }}
                  onFocus={() => palette?.onOpen()}
                  className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  aria-label="展开命令面板"
                  title="展开命令面板"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (palette?.open ? palette?.onClose() : palette?.onOpen())}
                  className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted"
                >
                  <CaretDown
                    className={cn("h-3.5 w-3.5 transition-transform", palette?.open && "rotate-180")}
                    weight="bold"
                  />
                </button>
              </div>
              {/* 结果区：一体展开在卡片内（inline 模式：borderTop 分隔，无遮罩/无悬浮层） */}
              {palette?.open && (
                <CommandPalette
                  inline
                  open
                  onClose={palette.onClose}
                  actions={palette.actions}
                  query={palette.query}
                  bindInput={inputRef}
                />
              )}
            </div>
          </div>
          <div className="flex-1" />
        </>
      ) : (
        <>
          <div className="flex-1" />
          {/* 搜索框隐藏（窄宽度）时 ⌘K 仍可打开：下拉锚定在标题区右侧 */}
          {palette?.open && (
            <CommandPalette
              open
              onClose={palette.onClose}
              actions={palette.actions}
              query={palette.query}
              panelClassName="right-5 top-full mt-2 w-[360px]"
            />
          )}
        </>
      )}
    </div>
  );
}

// ================================================================
// 悬停操作栏
// ================================================================

function HoverActions({ text, time }: { text: string; time?: string }) {
  const [speaking, setSpeaking] = useState(false);
  // 重试状态行（参考 dsh retry：前端倒计时展示，避免时钟偏差）
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  // 朗读结束轮询定时器：存 ref，unmount 时清理，避免组件销毁后 setState
  const speakTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (speakTimerRef.current !== null) window.clearInterval(speakTimerRef.current);
    },
    [],
  );
  // 分叉真化走引擎 session/fork：需要活跃会话与切换能力，由 props 注入
  const [forking, setForking] = useState(false);
  const actions = [
    ...(time ? [{ icon: Clock, label: time, clickable: false }] : []),
    { icon: Copy, label: "复制", clickable: true },
    { icon: GitFork, label: forking ? "分叉中…" : "分叉", clickable: !forking },
    { icon: RefreshCw, label: "重试", clickable: true },
    { icon: Volume2, label: "朗读", clickable: true },
  ];

  const handleAction = (label: string) => {
    if (label === "复制") {
      void navigator.clipboard.writeText(text).catch(() => {});
    } else if (label === "分叉") {
      // 真分叉：引擎 session/fork 复制 dsh 会话（最近完成回合边界），
      // 新前端会话由 sidecar 映射到分叉出的 dsh 子会话，切换即回放全部上文
      void (async () => {
        setForking(true);
        try {
          const src = $activeSessionId.get();
          const created = createSession(`分叉 · ${text.slice(0, 20)}`);
          await invoke("dsh_rpc", {
            method: "session/fork",
            params: { sourceSessionId: src, newSessionId: created.id },
          });
          markSessionContent(created.id);
          appendSystemMessage(`✂️ 已从此消息分叉到新会话「${created.title}」`);
          setActiveSession(created.id);
        } catch (e) {
          appendSystemMessage(`⚠️ 分叉失败：${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setForking(false);
        }
      })();
    } else if (label === "重试") {
      // 重试状态行：前端倒计时（参考 dsh retry UI）
      setRetrying(true);
      let sec = 3;
      setRetryCount(sec);
      const timer = window.setInterval(() => {
        sec -= 1;
        setRetryCount(sec);
        if (sec <= 0) {
          window.clearInterval(timer);
          setRetrying(false);
        }
      }, 1000);
      if (MOCK) {
        window.setTimeout(
          () => appendSessionAiMessage($activeSessionId.get(), "好的，我重新回答这个问题。（演示重试）"),
          1200,
        );
      } else {
        void getApi()
          .submitPrompt($activeSessionId.get(), text)
          .catch(() => appendSystemMessage("重试提交失败"));
      }
    } else if (label === "朗读") {
      if (isSpeaking()) {
        stopSpeaking();
        setSpeaking(false);
        if (speakTimerRef.current !== null) {
          window.clearInterval(speakTimerRef.current);
          speakTimerRef.current = null;
        }
      } else {
        speak(text);
        setSpeaking(true);
        // 朗读结束自动复位
        speakTimerRef.current = window.setInterval(() => {
          if (!isSpeaking()) {
            if (speakTimerRef.current !== null) {
              window.clearInterval(speakTimerRef.current);
              speakTimerRef.current = null;
            }
            setSpeaking(false);
          }
        }, 400);
      }
    }
  };

  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
      {actions.map((act, i) => (
        <button
          key={i}
          disabled={!act.clickable}
          onClick={() => act.clickable && handleAction(act.label)}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
            act.clickable
              ? "text-muted-foreground hover:text-[#303030] hover:bg-muted cursor-pointer"
              : "text-muted-foreground/60 cursor-default",
          )}
          title={act.label}
        >
          <act.icon
            className={cn(
              "h-3.5 w-3.5",
              act.label === "朗读" && speaking && "text-[#6366F1]",
              act.label === "重试" && retrying && "text-[#F59E0B]",
            )}
            strokeWidth={2}
          />
          {i === 0 && <span>{act.label}</span>}
        </button>
      ))}
      {/* 重试状态行（前端倒计时，参考 dsh retry） */}
      {retrying && (
        <span className="flex items-center gap-1 text-[11px] text-[#F59E0B]">
          <RefreshCw className="h-3 w-3 animate-spin" />
          重试中… {retryCount}s
        </span>
      )}
    </div>
  );
}

// ================================================================
// 对话内容区
// ================================================================

// ================================================================
// 对话内容区（模拟多轮对话）
// ================================================================

interface ChatMsg {
  role: "user" | "ai" | "system";
  text: string;
  time: string;
  systemType?: "steer" | "slash" | "plain";
  /** 消息日期（YYYY-MM-DD；日期分隔线用，缺省视为今天） */
  date?: string;
  /** 关联工具调用 id（真实模式 tool.start 标记） */
  toolId?: string;
}

// 后台任务触发器（dsh ui-jobs JobListAction 对齐：header 处运行中计数 +
// 弹出任务列表；引擎 /bg list + /bg cancel 驱动，真实模式可用）
function JobsAction() {
  const [jobs, setJobs] = useState<{ id: string; label: string; status: "running" | "done" | "failed" | "error" }[]>([]);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = (): void => {
    if (MOCK) return;
    void getApi()
      .runCommand($activeSessionId.get(), "/bg list")
      .then((res) => {
        const nodes: { id: string; label: string; status: "running" | "done" | "failed" | "error" }[] = [];
        for (const raw of res.output.split("\n")) {
          const line = raw.trim();
          if (!line.startsWith("- ")) continue;
          const m = /^(\S+)\s+\[([^\]]+)\]\s*(.*)$/.exec(line.slice(2));
          if (!m) continue;
          const statusRaw = m[2].toLowerCase();
          const failed = statusRaw.startsWith("failed");
          const cancelled = statusRaw.startsWith("cancelled");
          const running = statusRaw.startsWith("running");
          nodes.push({
            id: m[1],
            label: m[3].trim() || m[1],
            status: failed ? "failed" : cancelled ? "error" : running ? "running" : "done",
          });
        }
        setJobs(nodes);
      })
      .catch(() => setJobs([]));
  };
  useEffect(() => {
    load();
  }, []);

  // 打开时点外部关闭
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const running = jobs.filter((j) => j.status === "running").length;
  if (MOCK || jobs.length === 0) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] text-[#303030] transition-colors hover:bg-muted"
        title="后台任务（/btw · /bg）"
      >
        {running > 0 && <span className="h-1.5 w-1.5 rounded-full bg-[#6366F1]" />}
        <span className="tabular-nums">{jobs.length}</span> 后台任务
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-80 rounded-lg border border-border bg-white p-2 shadow-xl">
          <div className="flex items-center justify-between border-b border-border/60 pb-1 pl-1">
            <span className="text-[11px] font-medium text-[#303030]">
              后台任务{running > 0 && <span className="ml-1 text-[#6366F1]">· {running} 运行中</span>}
            </span>
            <button
              onClick={load}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-[#303030]"
              aria-label="刷新"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {jobs.map((j) => (
              <div key={j.id} className="flex items-center gap-2 px-1 py-1.5">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    j.status === "running" && "bg-[#6366F1]",
                    j.status === "done" && "bg-[#10B981]",
                    (j.status === "failed" || j.status === "error") && "bg-[#EF4444]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] text-[#303030]">{j.label}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{j.id}</span>
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {j.status === "running" ? "运行中" : j.status === "done" ? "已完成" : j.status === "failed" ? "失败" : "已取消"}
                </span>
                {j.status === "running" && (
                  <button
                    onClick={() => {
                      void getApi()
                        .runCommand($activeSessionId.get(), `/bg cancel ${j.id}`)
                        .then(load);
                    }}
                    className="shrink-0 text-[10px] text-[#EF4444] transition-colors hover:underline"
                  >
                    取消
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// 会话目标栏（dsh GoalBar 对齐：当前会话目标 + 状态点 + 内联编辑）
function GoalBar() {
  const goal = useStore($goalState);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal.text);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = (): void => {
    const v = draft.trim();
    if (v) {
      setGoal(v);
    } else {
      clearGoal();
    }
    setEditing(false);
  };

  const statusColor =
    goal.status === "active"
      ? "bg-[#6366F1]"
      : goal.status === "done"
        ? "bg-[#10B981]"
        : goal.status === "paused"
          ? "bg-[#F59E0B]"
          : "bg-[#9CA3AF]";
  const statusLabel =
    goal.status === "active"
      ? "进行中"
      : goal.status === "done"
        ? "已完成"
        : goal.status === "paused"
          ? "已暂停"
          : goal.status === "waiting"
            ? "等待中"
            : "";

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <Target className="h-3 w-3 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          onBlur={save}
          placeholder="描述本次会话目标…"
          className="h-6 w-64 rounded-md border border-border bg-white px-2 text-[11px] text-[#303030] outline-none focus:border-[#6366F1]"
        />
      </div>
    );
  }

  if (!goal.text) {
    return (
      <button
        onClick={() => {
          setDraft("");
          setEditing(true);
        }}
        className="flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-[#303030]/30 hover:text-[#303030]"
        title="设定本次会话目标"
      >
        <Target className="h-3 w-3" />
        设定目标
      </button>
    );
  }

  return (
    <span
      className="flex max-w-[360px] items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-[11px] text-[#303030]"
      title={`目标 · ${statusLabel || "未激活"}`}
    >
      <Target className="h-3 w-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{goal.text}</span>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusColor}`} />
      <button
        onClick={() => {
          setDraft(goal.text);
          setEditing(true);
        }}
        className="shrink-0 text-muted-foreground transition-colors hover:text-[#303030]"
        aria-label="编辑目标"
      >
        <Pencil className="h-2.5 w-2.5" />
      </button>
    </span>
  );
}

// 消息源：mock 模式按会话隔离（session-chat store 惰性生成，切换会话内容跟随），
// 真实模式用 $liveMessages（relay:reply 事件驱动）。
/** 新建任务引导页（中栏空态，参考 dsh hero：大标语 + 工作区/智能体 chips + 输入提示；
 *  底部 Composer 发送第一条消息后 hero 消失进入对话） */
/** 文件夹图（canvas 绘制 → data URI，供 WebGL 画廊做纹理；选中版高亮） */
/** 画廊错误边界：WebGL 初始化失败时降级为提示，不白屏 */
class GalleryBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[gallery] WebGL init failed:", err);
  }
  render() {
    if (this.state.failed) {
      return <p className="text-body-sm text-muted-foreground">画廊初始化失败（WebGL 不可用）——可直接在下方输入任务开始</p>;
    }
    return this.props.children;
  }
}

/** 文件夹图（canvas 绘制 → data URI）：项目名画在文件夹上方（最多两行），选中版高亮 */
function makeFolderImage(name: string, selected: boolean): string {
  const c = document.createElement("canvas");
  // 2x 分辨率：关 mipmap 后缩小走线性采样，高分辨率缓解锯齿
  c.width = 800;
  c.height = 600;
  const ctx = c.getContext("2d")!;
  const S = 2; // 2x 分辨率（下述坐标按 400×300 设计稿乘 S）
  const rr = (x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x * S + r * S, y * S);
    ctx.arcTo(x * S + w * S, y * S, x * S + w * S, (y + h) * S, r * S);
    ctx.arcTo(x * S + w * S, (y + h) * S, x * S, (y + h) * S, r * S);
    ctx.arcTo(x * S, (y + h) * S, x * S, y * S, r * S);
    ctx.arcTo(x * S, y * S, x * S + w * S, y * S, r * S);
    ctx.closePath();
  };
  // 项目名：写在文件夹上方（最多两行，逐字换行）
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 ${30 * S}px system-ui, sans-serif`;
  ctx.fillStyle = selected ? "#6366F1" : "#4B5563";
  const maxLineW = 340 * S;
  const lines: string[] = [];
  let cur = "";
  for (const ch of name) {
    if (cur && ctx.measureText(cur + ch).width > maxLineW) {
      lines.push(cur);
      cur = ch;
      if (lines.length === 2) break;
    } else cur += ch;
  }
  if (lines.length < 2 && cur) lines.push(cur);
  const lineH = 44 * S;
  const startY = 60 * S - (Math.min(lines.length, 2) - 1) * (lineH / 2);
  lines.slice(0, 2).forEach((ln, li) => {
    ctx.fillText(ln, 200 * S, startY + li * lineH);
  });
  // 文件夹：上盖
  ctx.fillStyle = selected ? "#6366F1" : "#AEB8E8";
  rr(70, 130, 200, 40, 12);
  ctx.fill();
  // 文件夹：正面渐变
  const g = ctx.createLinearGradient(0, 155 * S, 0, 280 * S);
  if (selected) {
    g.addColorStop(0, "#8B95F5");
    g.addColorStop(1, "#6366F1");
  } else {
    g.addColorStop(0, "#E7EBF8");
    g.addColorStop(1, "#D2DAEE");
  }
  ctx.fillStyle = g;
  rr(50, 155, 300, 130, 16);
  ctx.fill();
  return c.toDataURL("image/png");
}

/**
 * ProjectGalleryHero — 新对话/新建任务页主区（v8）：WebGL 弧形画廊（参考 circular-gallery-2）
 *
 * - 文件夹卡片沿弧线排布（bend），拖拽带惯性（lerp 缓动），无缝无限循环
 * - 点击文件夹 = 固定选中（靛蓝描边高亮）；再点取消
 * - 选中时新建项目区隐藏，取消后重新出现；名称输入框上方是「自定义工作区」（和 dsh 一样）
 */
function ProjectGalleryHero() {
  const projects = useStore($projects);
  const selectedId = useStore($selectedProjectId);
  const [newName, setNewName] = useState("");

  const items = useMemo(
    () => projects.map((p) => ({ image: makeFolderImage(p.name, p.id === selectedId), text: "" })),
    [projects, selectedId],
  );
  const selectedIdx = selectedId ? projects.findIndex((p) => p.id === selectedId) : -1;

  const onItemClick = (idx: number) => {
    const p = projects[idx % Math.max(1, projects.length)];
    if (!p) return;
    if (selectedId === p.id) selectProject(null); // 再点取消 → 新建区回来
    else selectProject(p.id); // 固定选中
  };

  const confirmNew = () => {
    const name = newName.trim();
    if (!name) return;
    const p = createProject(name);
    setNewName("");
    selectProject(p.id); // 新项目固定选中（新建区随之隐藏）
  };

  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-8 pb-4 text-center">
      <h1 className="text-2xl font-bold text-[#303030]">选择项目开始</h1>

      {/* ---- WebGL 弧形画廊：拖拽惯性 / 无缝循环 / 点击选中高亮（错误边界：WebGL 失败不白屏） ---- */}
      {projects.length === 0 ? (
        <p className="mt-6 text-body-sm text-muted-foreground">还没有项目——在下方创建第一个</p>
      ) : (
        <div className="mt-2 h-[280px] w-full">
          <GalleryBoundary>
            <CircularGallery
              items={items}
              onItemClick={onItemClick}
              selectedIndex={selectedIdx >= 0 ? selectedIdx : null}
              bend={-2}
              borderRadius={0.08}
              scrollSpeed={2}
              scrollEase={0.03}
            />
          </GalleryBoundary>
        </div>
      )}
      {selectedId && (
        <p className="text-[11px] text-muted-foreground">
          已选 {projects.find((p) => p.id === selectedId)?.name}
          {projects.find((p) => p.id === selectedId)?.cwd ? " · 自定义工作区生效" : ""}，再点该文件夹取消；直接输入任务开始
        </p>
      )}

      {/* ---- 新建项目（选中后隐身保留占位：布局不闪动；取消选择恢复可见） ---- */}
      <div
        className={cn(
          "mt-3 w-full max-w-[420px]",
          selectedId && "invisible opacity-0",
        )}
        aria-hidden={!!selectedId}
      >
        <p className="text-xs font-semibold text-[#303030]">新建项目</p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") confirmNew();
            }}
            placeholder="新项目名称…"
            className="min-w-0 flex-1 rounded-xl border border-border bg-white px-3 py-2.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]/50"
          />
          <button
            onClick={confirmNew}
            disabled={!newName.trim()}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#6366F1] text-white shadow transition-opacity hover:opacity-90 disabled:opacity-40"
            title="创建项目"
          >
            <Check className="h-5 w-5" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </div>
  );
}

/** dsh 档空会话初始页：对齐 dsh 本身（无 hero，仅输入框），顶部一行轻提示 */
function DshEmpty() {
  return (
    <div className="flex h-full min-h-[140px] flex-col items-center justify-center px-8 pb-10 text-center">
      <div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-[#303030]/75">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#6366F1]" />
        DeepSeek Harness
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground/60">输入消息开始新的回合</p>
    </div>
  );
}

const ChatSection = memo(function ChatSection({
  detailsExpanded,
  onToggleDetails,
}: {
  detailsExpanded: boolean;
  onToggleDetails: () => void;
}) {
  const [trajectoryOpen, setTrajectoryOpen] = useState(false);
  // 左侧栏「查看调用轨迹」菜单 → 全局请求 → 打开轨迹弹窗
  const trajectoryReq = useStore($trajectoryRequest);
  useEffect(() => {
    if (trajectoryReq > 0) setTrajectoryOpen(true);
  }, [trajectoryReq]);
  // Plan 模式（参考 dsh ui-plan：只分析规划，不修改文件）；
  // 与 Composer 三模式中的「计划模式」全局联动（$agentMode === "plan"）
  const agentMode = useStore($agentMode);
  const planMode = agentMode === "plan";
  const togglePlanMode = useCallback(() => {
    setAgentMode(planMode ? "workspace" : "plan");
  }, [planMode]);
  // 通用设置（设置-通用设置）：对话宽度 / 对话风格 / 聊天背景
  const chatWidth = useStore($chatWidth);
  const chatStyle = useStore($chatStyle);
  const backdrop = useStore($chatBackdrop);
  const widthPx = CHAT_WIDTH_PX[chatWidth];
  const bodyRef = useRef<HTMLDivElement>(null);
  // 消息源：mock 模式用当前会话的消息（惰性生成），真实 hermes 用实时 store（relay:reply）
  const live = useStore($liveMessages);
  const activeId = useStore($activeSessionId);
  const chatMap = useStore($sessionChat);
  const sessions = useStore($sessions);
  // 发送失败重试条：读 atom 的值（直接引用 atom 对象恒为真，会导致警告常驻）
  const lastFailedPrompt = useStore($lastFailedPrompt);
  const activeTitle = sessions.find((s) => s.id === activeId)?.title ?? "新会话";
  const msgs = MOCK ? (chatMap.get(activeId) ?? getSessionChat(activeId, activeTitle)) : live;
  // 统计条已移至输入框下方（数据来自装配层投影 $assemblyProjections，见 StatsLine）

  // 聊天记录工具菜单（记录 + 会话标签页显隐）
  const [toolOpen, setToolOpen] = useState(false);
  const showTabsIn = useStore($showSessionTabs);
  // Ctrl+F → 打开"聊天记录"弹窗（微信查找聊天记录样式，替代 inline 查找条）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openChatHistory();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 聊天记录弹窗点结果 → requestJump(消息索引) → 虚拟滚动定位 + 闪烁
  const jumpReq = useStore($jumpRequest);
  useEffect(() => {
    if (jumpReq === null) return;
    $jumpRequest.set(null);
    if (jumpReq < 0 || jumpReq >= msgs.length) return;
    virtuosoRef.current?.scrollToIndex({ index: jumpReq, align: "start" });
    // 目标行由 Virtuoso 渲染后闪烁（行 DOM 可能尚未挂载，延迟重试一次）
    window.setTimeout(() => {
      const el = msgRefs.current[jumpReq];
      el?.classList.add("hermes-find-flash");
      window.setTimeout(() => el?.classList.remove("hermes-find-flash"), 1200);
    }, 250);
  }, [jumpReq, msgs]);

  // ---- 消息定位器（官方 TurnNavigator：右侧回合轨 + 悬停预览 + 点击跳转）----
  const [activeMsg, setActiveMsg] = useState(0);
  const msgRefs = useRef<(HTMLDivElement | null)[]>([]);
  // 每条用户消息 = 一个回合锚点（turn 按顺序编号）；回复预览取其后的首条 AI 消息
  const navItems = useMemo<TurnNavigationItem[]>(() => {
    const items: TurnNavigationItem[] = [];
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].role !== "user") continue;
      let response = "";
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === "ai") {
          response = msgs[j].text;
          break;
        }
        if (msgs[j].role === "user") break;
      }
      items.push({ turn: items.length + 1, anchorKey: String(i), prompt: msgs[i].text, response });
    }
    return items;
  }, [msgs]);
  // 当前视口顶部所在回合（scrollspy：activeMsg 之前出现的用户消息计数）
  const activeTurn = useMemo(() => {
    let seen = 0;
    for (let i = 0; i < msgs.length && i <= activeMsg; i++) {
      if (msgs[i].role === "user") seen += 1;
    }
    return seen > 0 ? seen : null;
  }, [msgs, activeMsg]);
  // 官方组件要求 props 引用稳定（memo 防流式期间每 delta 重建轨道）
  const onNavNavigate = useCallback((item: TurnNavigationItem) => {
    const index = Number(item.anchorKey);
    setActiveMsg(index);
    virtuosoRef.current?.scrollToIndex({ index, align: "start" });
  }, []);
  // 官方 t() 三键（label/jump/turn）中文实现
  const navT = useCallback<TurnNavigatorT>((key, vars) => {
    if (key === "chat.turnNavigation.jump") return `跳转到第 ${vars?.turn ?? 0} 轮`;
    if (key === "chat.turnNavigation.turn") return `第 ${vars?.turn ?? 0} 轮`;
    return "消息定位";
  }, []);

  // 不在底部时显示"滚动到底部"按钮
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // 自动跟随最新消息：由 Virtuoso followOutput 接管（isAtBottom 由 Virtuoso 计算，
  // 用户上滚后自动停止跟随；原来每 delta 强制同步 reflow 的 useEffect 已移除）
  const nearBottomRef = useRef(true);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const scrollerRefCb = useCallback((el: Window | HTMLElement | null) => {
    scrollerRef.current = el instanceof HTMLElement ? (el as HTMLDivElement | null) : null;
  }, []);

  // 第一条 AI 消息索引（思考步骤/操作栏挂在它上面）
  const firstAiIdx = msgs.findIndex((m) => m.role === "ai");

  // 工具调用（从 store 读取）
  const toolCalls = useStore($toolCalls);
  // AI 是否正在流式输出（真实模式；mock 恒 false）
  const streaming = useStore($aiStreaming);
  // 引擎忙碌（发送后未完成）：按活跃会话分桶读——A 回复中切到 B，B 不显示等待指示
  const busyMap = useStore($busyMap);
  const agentBusy = !!busyMap[activeId ?? ""];

  // 滚动处理：轨道显示 / 空心圆位置 / 底部按钮（scrollspy 由 Virtuoso rangeChanged
  // 接管——虚拟化后看不到行 DOM，逐行 offsetTop 扫描失效；range 的首行即当前可见位）
  const scrollRafRef = useRef(0);
  const handleBodyScroll = (e?: React.UIEvent) => {
    const el = (e?.currentTarget as HTMLElement | undefined) ?? scrollerRef.current;
    if (!el) return;
    if (scrollRafRef.current) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      const max = el.scrollHeight - el.clientHeight;
      const atBottom = max - el.scrollTop < 40;
      nearBottomRef.current = atBottom;
      setShowScrollBottom(!atBottom);
    });
  };

  const handleRangeChange = useCallback((range: { startIndex: number; endIndex: number }) => {
    if (range.startIndex >= 0) setActiveMsg(range.startIndex);
  }, []);

  const scrollToBottom = () => {
    virtuosoRef.current?.scrollToIndex({ index: Math.max(0, msgs.length - 1), align: "end" });
  };

  // 等待指示（AI 消息样式：头像 + 名字 + 思考气泡 + 工作中计时）：
  // 渲染在消息列表末尾（Virtuoso Footer）——即"AI 回复将出现的位置"，
  // 流式第一步显示等待动画，内容出来后被真实气泡接替。
  // 判定：① 已发送但 AI 尚无流式输出（末条为 user）；② 流式中末条 AI 气泡还没内容。
  // 从尾部向前跳过 system 状态行，避免被状态消息打断。
  let lastNonSystem: { role: string; text?: string } | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]?.role !== "system") {
      lastNonSystem = msgs[i];
      break;
    }
  }
  const waiting =
    agentBusy &&
    (lastNonSystem?.role === "user" || (lastNonSystem?.role === "ai" && !lastNonSystem.text));

  // 列表尾部挂件引用稳定化：busy 秒数计时在 WaitingIndicator 内部自跑，
  // 不进 MainPanel 渲染路径——MessageList 的 memo 在等待期间不被每秒击穿
  const listFooter = useMemo(
    () => (
      <>
        {waiting && <WaitingIndicator />}
        {!agentBusy && !streaming && (
          <FileChangesRow toolCalls={toolCalls} className="mx-4 mb-1" />
        )}
      </>
    ),
    [waiting, agentBusy, streaming, toolCalls],
  );

  return (
    // 无外层 padding：滚动容器从对话区顶部开始，顶部不再有固定的 padding 灰带；
    // 左右 padding 在滚动容器上（固定），垂直 padding 在内容上（随滚动）
    <div className="relative flex shrink-0 min-h-[150px] flex-1 flex-col group">
      {/* Plan 模式芯片（参考 dsh ui-plan：对话区顶部指示 + 退出）+ 会话目标栏（dsh GoalBar） */}
      <div className="flex shrink-0 items-center gap-2 px-5 pb-1">
          {planMode && (
            <button
              onClick={togglePlanMode}
              className="flex items-center gap-1 rounded-full bg-[#F59E0B]/10 px-2.5 py-0.5 text-[11px] font-medium text-[#B45309] transition-colors hover:bg-[#F59E0B]/20"
              title="退出 Plan 模式"
            >
              <ListTodo className="h-3 w-3" />
              Plan 模式
              <X className="h-3 w-3" />
            </button>
          )}
          {planMode && <span className="text-[11px] text-muted-foreground">仅做分析与规划，不修改文件</span>}
          <GoalBar />
          <JobsAction />
        </div>
      {/* 滚动容器包裹层（relative）：官方 TurnNavigator 的绝对定位参照系，
          与滚动容器同几何（不含 Composer），轨带垂直居中 */}
      <div className="relative flex min-h-0 flex-1">
      {/* 滚动容器：bodyRef 不再滚动（overflow-hidden），滚动交给 Virtuoso 的
          scroller（自定义滚动条经 scrollerRef 绑定）；限宽容器在内部居中 */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-hidden px-5">
        {/* 消息列表容器：限宽居中（对话宽度三档 820/1080/无限制，参考 zosma --chat-max-width），
            对话区加宽时内容不再撑满，两边留白。
            对话风格 dsh系统 = 紧凑行式（chat-style-dsh）；聊天背景开启 = 淡色渐变 */}
        {/* 空会话（新建任务）：默认档 = 中栏引导页 hero；dsh 档 = dsh 初始页
            （无 hero，只有输入框；顶部给一行轻提示，不抢视觉） */}
        {msgs.length === 0 ? (
          chatStyle === "dsh" ? <DshEmpty /> : <ProjectGalleryHero />
        ) : (
        <div
          className={cn(
            "mx-auto flex h-full w-full flex-col py-3",
            chatStyle === "dsh" && "chat-style-dsh",
            backdrop === "on" && "chat-backdrop-on",
          )}
          style={{ maxWidth: widthPx === null ? "none" : `${widthPx}px` }}
        >
          {/* 压缩标记行由真实事件驱动（compaction/summary → CompactionRow），
              不再用 30 条假阈值演示 */}
          {/* 虚拟滚动消息列表（Virtuoso：百万级消息只渲染视口 ±800 行）；
            key=activeId 让切会话时 remount 并定位到最新 */}
          <div className="min-h-0 flex-1">
          <MessageList
            key={activeId}
            msgs={msgs}
            firstAiIdx={firstAiIdx}
            toolCalls={toolCalls}
            streaming={streaming}
            findTerm=""
            detailsExpanded={detailsExpanded}
            msgRefs={msgRefs}
            flat={chatStyle === "dsh"}
            virtuosoRef={virtuosoRef}
            scrollerRefCb={scrollerRefCb}
            onScroll={handleBodyScroll}
            onRangeChange={handleRangeChange}
            initialIndex={Math.max(0, msgs.length - 1)}
            footer={listFooter}
          />
          </div>

          {/* 发送失败重试条（引擎报错后出现；点重试重新发送上次提示词） */}
          {lastFailedPrompt && (
            <div className="flex items-center justify-center gap-2 py-1">
              <span className="text-[11px] text-[#EF4444]">⚠️ 发送失败</span>
              <button
                onClick={() => {
                  const t = $lastFailedPrompt.get();
                  setLastFailedPrompt(null);
                  if (t) sendMessage(t);
                }}
                className="rounded-md border border-border px-2.5 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted"
              >
                重试
              </button>
              <button
                onClick={() => setLastFailedPrompt(null)}
                className="rounded-md border border-border px-2.5 py-0.5 text-[11px] text-[#464646] transition-colors hover:bg-muted"
              >
                忽略
              </button>
            </div>
          )}

          {/* 会话统计条已移至输入框下方（对齐官方 composer.dock 语义） */}
        </div>
        )}
        </div>

        {/* 消息定位器（官方 TurnNavigator：右侧回合导航轨，悬停预览，点击跳转） */}
        <TurnNavigator items={navItems} activeTurn={activeTurn} onNavigate={onNavNavigate} t={navT} />
      </div>

      {/* 自定义滚动条（统一组件：细线 + 空心圆）；绑定 Virtuoso scroller */}
      <CustomScrollbar scrollRef={scrollerRef} className="absolute right-1 top-2 bottom-2" />

      {/* 滚动到底部按钮（内容不在底部时显示，24px 白色图标） */}
      {showScrollBottom && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full border border-black/10 bg-white text-[#303030] shadow-md transition-colors hover:bg-muted"
          title="滚动到底部"
        >
          <ArrowDown className="h-4 w-4" strokeWidth={2.5} />
        </button>
      )}

      {/* 活动窗口（对话区右上角，可折叠浮动面板） */}
      <StatusWindow />

      {/* 聊天记录工具按钮（StatusWindow 左侧）：聊天记录 + 会话标签页显隐 */}
      <div className="absolute right-[52px] top-3 z-30">
        <button
          onClick={() => setToolOpen((v) => !v)}
          title="聊天记录工具"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 bg-white text-[#464646] shadow-sm transition-colors hover:bg-muted"
        >
          <History className="h-4 w-4" strokeWidth={2} />
        </button>
        {toolOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setToolOpen(false)} />
            <div className="panel-glass menu-anim absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl py-1">
              <button
                onClick={() => {
                  setToolOpen(false);
                  openChatHistory();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              >
                <History className="h-3.5 w-3.5 text-muted-foreground" />
                聊天记录
                <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+F</span>
              </button>
              <button
                onClick={() => {
                  setToolOpen(false);
                  toggleSessionTabs();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              >
                <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
                {showTabsIn ? "隐藏会话标签页" : "显示会话标签页"}
              </button>
              {/* 详细模式开关（Ctrl+O 同款：工具详情/思考全量展开） */}
              <button
                onClick={() => {
                  setToolOpen(false);
                  onToggleDetails();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              >
                <Rows3 className="h-3.5 w-3.5 text-muted-foreground" />
                {detailsExpanded ? "简洁模式" : "详细模式"}
                <span className="ml-auto text-[10px] text-muted-foreground">Ctrl+O</span>
              </button>
              {/* 运行轨迹弹窗（参考 deepseek-harness TrajectoryView） */}
              <button
                onClick={() => {
                  setToolOpen(false);
                  setTrajectoryOpen(true);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              >
                <Waypoints className="h-3.5 w-3.5 text-muted-foreground" />
                运行轨迹
              </button>
              {/* Plan 模式开关（参考 dsh ui-plan；与 Composer 四模式联动） */}
              <button
                onClick={() => {
                  setToolOpen(false);
                  togglePlanMode();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
              >
                <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
                {planMode ? "退出 Plan 模式" : "Plan 模式"}
              </button>
            </div>
          </>
        )}
      </div>

      {/* 运行轨迹弹窗（参考 deepseek-harness TrajectoryView）：关闭时不挂载，
          避免 closed 状态下每 delta 全量 deriveEvents 遍历 */}
      {trajectoryOpen && (
        <TrajectoryOverlay
          open
          onClose={() => setTrajectoryOpen(false)}
          msgs={msgs}
          toolCalls={toolCalls}
        />
      )}
    </div>
  );
});

// ================================================================
// MessageList — 消息列表（memo：滚动/布局/弹窗变化时整体跳过重渲染）
// 400 条 mock 消息 + 每条 markdown 渲染很重，props 不变必须整体 bail out。
// ================================================================

type AnyMsg = ChatMsg | LiveChatMessage;

// ---- 日期分隔线工具（参考 astryx ChatSystemMessage divider） ----

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dateLabel(date: string): string {
  const today = new Date();
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  if (date === ymd(today)) return "今天";
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (date === ymd(y)) return "昨天";
  const [, mm, dd] = date.split("-").map(Number);
  return `${mm}月${dd}日`;
}

/** 消息日期（缺省视为今天） */
function msgDate(m: AnyMsg): string {
  return "date" in m && m.date ? m.date : todayYmd();
}

/** 产出文件提取（参考 dsh ui-deliverables：从 AI 回复提取文件路径 chips） */
function extractFiles(text: string): string[] {
  const re = /(?:已写入|已保存|写入|保存|修改|Wrote|Created|Edited|Saved|Updated)\s+(?:到|至|to)\s+([\w./\\-]+(?:\.[\w]+)?)/g;
  const files: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null && files.length < 6) {
    if (!files.includes(m[1])) files.push(m[1]);
  }
  return files;
}

/** ToolCall（tool-calls store）→ DshToolCallInfo（dsh ToolRow 输入形态） */
function toDshToolInfo(call: ToolCall): DshToolCallInfo {
  return {
    id: call.id,
    name: call.name,
    args: call.args ?? {},
    status: call.status === "warning" ? "completed" : call.status,
    ...(call.result !== undefined ? { result: call.result } : {}),
    ...(call.partialOutput !== undefined ? { partialOutput: call.partialOutput } : {}),
    isError: call.status === "error",
  };
}

/** 从工具调用参数提取产出文件（对齐 dsh ui-deliverables：write/edit 工具的 file_path） */
function extractToolFiles(calls: ToolCall[]): string[] {
  const out = new Set<string>();
  for (const c of calls) {
    if (!c.args) continue;
    const p = c.args.file_path ?? c.args.path ?? c.args.target;
    if (typeof p === "string" && p.trim()) out.add(p.trim());
  }
  return [...out];
}

/** 消息相关的工具调用：按 toolId/messageId 归属；无关联（旧数据/mock）兜底首条 AI */
/** 产物文件点击 → 右侧栏「预览」面板打开（AppLayout 监听该事件切面板） */
function openFilePreview(path: string): void {
  setPreviewUrl(path, path.split(/[\\/]/).pop() ?? path);
  window.dispatchEvent(new CustomEvent("mirach:open-preview"));
}

function relatedTools(m: AnyMsg, i: number, firstAiIdx: number, calls: ToolCall[]): ToolCall[] {
  if (m.toolId) return calls.filter((c) => c.id === m.toolId);
  return calls.filter(
    (c) => c.messageId === (m as LiveChatMessage).id || (!c.messageId && i === firstAiIdx),
  );
}

/** 日期分隔线：居中 pill */
function DateDivider({ date }: { date: string }) {
  return (
    <div className="flex items-center justify-center py-1">
      <span className="rounded-full bg-muted/60 px-3 py-0.5 text-[11px] text-muted-foreground">
        {dateLabel(date)}
      </span>
    </div>
  );
}

// 等待指示（AI 消息样式：头像 + 名字 + 思考气泡 + 工作中 X 秒计时）。
// 挂在 Virtuoso Footer = 对话区"AI 回复将出现的位置"：流式第一步显示等待动画，
// 内容出来后被真实气泡接替。计时器在组件内部自跑，不牵动父级重渲染。
const WaitingIndicator = memo(function WaitingIndicator() {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSec((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="flex items-start gap-2 px-4 py-2">
      {/* AI 头像 + 在线状态（对齐成员列表样式） */}
      <div className="relative shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#7C5CFF] text-[10px] font-bold text-white">
          奎
        </div>
        <span
          className="absolute rounded-full border-2 border-white"
          style={{ width: 10, height: 10, bottom: -2, right: -2, backgroundColor: "#10B981" }}
        />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-member font-medium text-[#303030]">奎木狼</p>
        <div className="mt-1 flex items-center gap-2 rounded-2xl bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#017CF3]" />
          <span className="text-xs tabular-nums text-muted-foreground">工作中 {sec} 秒</span>
        </div>
      </div>
    </div>
  );
});

const MessageList = memo(function MessageList({
  msgs,
  firstAiIdx,
  toolCalls,
  streaming,
  findTerm,
  detailsExpanded,
  msgRefs,
  flat,
  virtuosoRef,
  scrollerRefCb,
  onScroll,
  onRangeChange,
  initialIndex = 0,
  footer,
}: {
  msgs: AnyMsg[];
  firstAiIdx: number;
  toolCalls: ToolCall[];
  /** AI 是否正在流式输出（最后一条 AI 消息显示 streaming 徽章 + 闪烁光标） */
  streaming: boolean;
  /** 会话内查找词（正文 hast 层高亮命中，跳过 code/pre；空串不启用） */
  findTerm: string;
  /** 全局详细模式（Ctrl+O）：工具详情强制展开/收起 */
  detailsExpanded: boolean;
  msgRefs: MutableRefObject<(HTMLDivElement | null)[]>;
  /** dsh系统 风格：气泡平铺（无背景/描边/内边距），紧凑行式 */
  flat?: boolean;
  /** 虚拟滚动句柄（ChatSection 用 scrollToIndex 做定位/跳转） */
  virtuosoRef: MutableRefObject<VirtuosoHandle | null>;
  /** Virtuoso scroller（原生滚动元素）回调：转发给自定义滚动条 */
  scrollerRefCb: (el: Window | HTMLElement | null) => void;
  onScroll: (e: React.UIEvent) => void;
  onRangeChange: (range: { startIndex: number; endIndex: number }) => void;
  /** 初始定位索引（切会话 remount 时指向最新消息，模拟原"打开即见最新"） */
  initialIndex?: number;
  /** 列表尾部挂件（等待指示/文件更改汇总）：Virtuoso Footer，
   *  跟随消息流渲染在"AI 回复将出现的位置"，不再被 overflow 裁剪 */
  footer?: React.ReactNode;
}) {
  const { t } = useI18n();
  // 最后一条 AI 消息（流式指示挂它上面）
  const lastAiIdx = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "ai") return i;
    }
    return -1;
  })();
  // 逐消息赞踩（参考 dsh ui-message-feedback；本地状态 + 有引擎消息 id 时上报
  // messageFeedback.put，历史回放消息无 engineId 仅本地显示）。
  // 按消息 id 存（非索引）：历史重放/消息插入不会导致赞踩错位
  const [feedback, setFeedback] = useState<Record<string, "up" | "down" | undefined>>({});
  const toggleFeedback = (mid: string, vote: "up" | "down") => {
    setFeedback((fb) => ({ ...fb, [mid]: fb[mid] === vote ? undefined : vote }));
    const m = (msgs as LiveChatMessage[]).find((x) => x.id === mid);
    if (m?.role === "ai" && m.engineId) {
      void getApi()
        .sendMessageFeedback(m.engineId, vote === "up" ? "positive" : "negative")
        .then((ok) => appendSystemMessage(ok ? "反馈已上报 ✓" : "反馈上报失败（引擎拒绝）"))
        .catch(() => appendSystemMessage("反馈上报失败（调用异常）"));
    } else {
      appendSystemMessage(m?.role === "ai" ? "无引擎消息 id，无法上报" : "无 AI 消息");
    }
  };

  return (
    <>
      {msgs.length === 0 ? (
        <div className="flex h-full min-h-[150px] items-center justify-center text-body-sm text-muted-foreground">
          等待 Mirach 后端连接…（VITE_MOCK=0 模式）
        </div>
      ) : (
      <Virtuoso
        ref={virtuosoRef}
        scrollerRef={scrollerRefCb}
        data={msgs}
        initialTopMostItemIndex={initialIndex}
        followOutput={(isAtBottom) => (isAtBottom ? "smooth" : false)}
        rangeChanged={onRangeChange}
        onScroll={onScroll}
        overscan={800}
        style={{ height: "100%" }}
        components={
          footer
            ? {
                Footer: () => (
                  <div className="msg-row-cv pb-4">{footer}</div>
                ),
              }
            : undefined
        }
        itemContent={(i, m) => {
        // 日期分隔线：首条或跨天插入（今天/昨天/M月D日）
        const date = msgDate(m);
        const prevDate = i > 0 ? msgDate(msgs[i - 1]) : null;
        const showDivider = i === 0 || date !== prevDate;
        return (
          <div className="msg-row-cv pb-4">
            {showDivider && <DateDivider date={date} />}
            {m.role === "system" ? (
              /* 系统消息：压缩标记用 dsh CompactionRow，其余居中小字 */
              (m as LiveChatMessage).compaction ? (
                <div ref={(el) => { msgRefs.current[i] = el; }} className="flex justify-center py-1">
                  <CompactionRow info={(m as LiveChatMessage).compaction!} />
                </div>
              ) : (
                <div ref={(el) => { msgRefs.current[i] = el; }}>
                  <SystemMessage text={m.text} type={"systemType" in m ? m.systemType : undefined} />
                </div>
              )
            ) : m.role === "user" ? (
              /* 用户消息：右侧名字（用户01）+ 时间 + 头像 + 气泡 */
              <div ref={(el) => { msgRefs.current[i] = el; }} className="flex justify-end gap-3">
                <div className="max-w-[70%] min-w-0">
                  <div className="mb-2 flex items-center justify-end gap-2">
                    <span className="text-[15px] font-semibold tracking-tight text-[#303030]">用户01</span>
                    {m.time && <span className="text-[11px] text-muted-foreground/70">{m.time}</span>}
                  </div>
                  {/* 用户消息恒有气泡（dsh 紧凑行式仅 AI 无气泡；用户保持气泡，2026-08-21 用户要求） */}
                  <div className="break-words rounded-lg rounded-tr-none border border-black/10 bg-[#D2DAEC] px-4 py-3">
                    <div className="text-body-sm leading-relaxed text-[#303030]">
                      <MarkdownText content={m.text} highlightMentions findTerm={findTerm} />
                    </div>
                  </div>
                </div>
                {/* 用户头像 */}
                <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#303030] text-white text-sm font-bold">
                    ME
                  </div>
                  <span
                    className="absolute block rounded-full border-2 border-white"
                    style={{ width: 11, height: 11, bottom: -1, right: -1, backgroundColor: "#10B981" }}
                  />
                </div>
              </div>
            ) : (
              /* AI 消息：左侧头像 + 名字 + 气泡（带 ref：聊天记录跳转可定位 AI 消息） */
              <div ref={(el) => { msgRefs.current[i] = el; }} className="flex gap-3">
                <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-[#6366F1] text-white text-sm font-bold">
                    AI
                  </div>
                  <span
                    className="absolute block rounded-full border-2 border-white"
                    style={{ width: 11, height: 11, bottom: -1, right: -1, backgroundColor: "#10B981" }}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  {/* 名字 + 时间 + streaming 徽章（最后一条 AI 流式中） */}
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[15px] font-semibold tracking-tight text-[#303030]">DeepSeek Harness</span>
                    {m.time && <span className="text-[11px] text-muted-foreground/70">{m.time}</span>}
                    {streaming && i === lastAiIdx && (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#6366F1]" title="工作中" />
                    )}
                  </div>

                  {/* 思考（dsh 自带 Think 行：ReasoningRow，自带展开/收起） */}
                  {(m as LiveChatMessage).thinking && (
                    <div className="mb-2">
                      <ReasoningRow
                        text={(m as LiveChatMessage).thinking ?? ""}
                        running={streaming && i === lastAiIdx}
                        t={t}
                      />
                    </div>
                  )}

                  {/* 工具调用（真实模式按 toolId/messageId 关联到各自消息；无关联的兜底首条 AI）。
                      逐行展示（用户要求不合并），每行可点击展开 IN/OUT 详情 */}
                  {(() => {
                    const related = relatedTools(m, i, firstAiIdx, toolCalls);
                    if (related.length === 0) return null;
                    return (
                      <div className="mb-2">
                        {related.map((call) =>
                          flat ? (
                            <DshToolRow key={call.id} call={toDshToolInfo(call)} />
                          ) : (
                            <ToolEntry key={call.id} call={call} detailsExpanded={detailsExpanded} />
                          ),
                        )}
                      </div>
                    );
                  })()}

                  {/* AI 气泡：默认档白底描边；dsh 档紧凑转录式（无气泡 + 靛蓝左条） */}
                  <div className={flat ? "break-words border-l-2 border-[#6366F1]/25 pl-3" : "break-words rounded-lg rounded-tl-none border border-black/10 bg-[#FFFFFF] px-4 py-3"}>
                    {/* 空窗占位：流式中该消息尚无正文/思考（网关首包延迟数秒~十几秒），
                        渲染三点点+提示，杜绝"空气泡"观感 */}
                    {streaming && i === lastAiIdx && !("thinking" in m ? m.thinking : undefined) && (
                      <div className="mb-1 flex items-center gap-2 text-body-sm text-muted-foreground">
                        <span className="flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#6366F1]/70 [animation-delay:-0.3s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#6366F1]/70 [animation-delay:-0.15s]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#6366F1]/70" />
                        </span>
                        正在等待模型返回…
                      </div>
                    )}
                    <div className="text-body-sm leading-relaxed text-[#303030]">
                      {streaming && i === lastAiIdx ? (
                        // 流式行降级为纯文本（react-markdown 全量重解析是流式卡顿主因；
                        // complete 定稿后切回 MarkdownText 精渲染）
                        <span className="whitespace-pre-wrap break-words">{m.text}</span>
                      ) : (
                        <MarkdownText content={m.text} highlightMentions findTerm={findTerm} />
                      )}
                      {streaming && i === lastAiIdx && (
                        <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-pulse rounded-sm bg-[#6366F1] align-text-bottom" />
                      )}
                    </div>
                  </div>

                  {/* 产出文件行（对齐 dsh ui-deliverables：回复文本 + 工具参数 file_path 提取）。
                      点击 → 右侧栏「预览」面板打开文件（md 精渲染，其他文本展示） */}
                  {(() => {
                    const related = relatedTools(m, i, firstAiIdx, toolCalls);
                    const files = [...new Set([...extractFiles(m.text), ...extractToolFiles(related)])];
                    if (files.length === 0) return null;
                    return (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {files.map((f) => (
                          <button
                            key={f}
                            onClick={() => openFilePreview(f)}
                            className="cursor-pointer rounded border border-black/10 bg-muted/40 px-1.5 py-px font-mono text-[10px] text-muted-foreground transition-colors hover:border-[#6366F1]/40 hover:bg-[#6366F1]/10 hover:text-[#6366F1]"
                            title={`点击预览 ${f}`}
                          >
                            {f}
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  {/* 悬停操作栏：赞踩 + 复制/分叉/重试/朗读 + 消息分支（每条 AI 消息） */}
                  <div className="mt-2 flex items-center gap-3">
                    {/* 赞踩（参考 dsh message-feedback；按消息 id 存避免索引错位） */}
                    <div className="flex items-center gap-0.5">
                      <button
                        onClick={() => toggleFeedback((m as LiveChatMessage).id, "up")}
                        title="有帮助"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded transition-colors",
                          feedback[(m as LiveChatMessage).id] === "up" ? "text-[#6366F1]" : "text-muted-foreground/60 hover:text-[#6366F1]",
                        )}
                      >
                        <ThumbsUp className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                      <button
                        onClick={() => toggleFeedback((m as LiveChatMessage).id, "down")}
                        title="没帮助"
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded transition-colors",
                          feedback[(m as LiveChatMessage).id] === "down" ? "text-[#EF4444]" : "text-muted-foreground/60 hover:text-[#EF4444]",
                        )}
                      >
                        <ThumbsDown className="h-3.5 w-3.5" strokeWidth={2} />
                      </button>
                    </div>
                    <HoverActions text={m.text} time={m.time} />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
        }}
      />
      )}
    </>
  );
});

// ================================================================
// 终端区（标签栏 + 真实 PowerShell，见 components/chat/TerminalPanel.tsx）
// ================================================================

// ================================================================
// MainPanel
// ================================================================

interface MainPanelProps {
  className?: string;
  style?: React.CSSProperties;
  showLeft?: boolean;
  onExpandLeft?: () => void;
  /** 顶部命令搜索控制器（搜索框输入 + 结果下拉） */
  palette?: PaletteController;
  /** 左工具栏当前视图（chat 保持主聊天；其余渲染专属视图页） */
  activeView?: string;
  /** 主栏宽度数值（用于 HeaderSection 等内部布局；容器宽度走 CSS 变量） */
  mainWidth?: number;
}

// ---- 各组件共享的单例 ref：历史重放请求序号（见 ChatSection 的 dsh_get_history effect）----
const historyReqSeq = { current: 0 };

// 各区域可缩小的最小高度
const MIN_CHAT = 150;
const MIN_TERMINAL = 150;
// 终端最大高度 = 总高 - 顶85 - 底20 - 手柄6 - 对话区最小150 - 输入框最小106
const MAX_TERMINAL = 900 - 85 - 20 - 6 - MIN_CHAT - 106;

export function MainPanel({ className, style, showLeft = true, onExpandLeft, palette, activeView = "chat", mainWidth }: MainPanelProps) {
  // ---- 终端页展开/收起（默认收起） ----
  const [terminalOpen, setTerminalOpen] = useState(false);
  // ---- 终端高度（手柄拖拽调整；对话区 flex-1 自动吸收变化）----
  const [terminalH, setTerminalH] = useState(MIN_TERMINAL);
  // Ctrl+O 全局详细/简洁双档（参考 zosma：工具详情/思考一键切换技术视图）。
  // 状态放 MainPanel：ChatSection 卸载（工具类视图）时快捷键仍生效。
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [detailsToast, setDetailsToast] = useState(false);
  const detailsToastTimer = useRef<number | null>(null);
  // 切换详细模式（Ctrl+O 与工具菜单共用）：切换 + 短暂 toast 反馈
  const toggleDetails = useCallback(() => {
    setDetailsExpanded((v) => !v);
    setDetailsToast(true);
    if (detailsToastTimer.current !== null) window.clearTimeout(detailsToastTimer.current);
    detailsToastTimer.current = window.setTimeout(() => setDetailsToast(false), 2000);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "o") {
        // 阻止 WebView2/浏览器默认"打开文件"对话框
        e.preventDefault();
        e.stopPropagation();
        toggleDetails();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (detailsToastTimer.current !== null) window.clearTimeout(detailsToastTimer.current);
    };
  }, [toggleDetails]);
  // 主栏实际宽度（容器宽度走 CSS 变量；mainWidth 仅用于 HeaderSection 等内部布局）
  const mainW = mainWidth ?? 380;
  // 会话标签条显隐（聊天记录工具按钮可切换）
  const showTabs = useStore($showSessionTabs);
  // 对话风格（通用设置）：minimal = zosma 简约对话档（整块替换消息区 + Composer）
  const chatStyle = useStore($chatStyle);
  const activeId = useStore($activeSessionId);
  const sessionsAll = useStore($sessions);
  const activeTitle = sessionsAll.find((s) => s.id === activeId)?.title ?? "新会话";
  // 引擎提问（ask_user_question 待答批次；所有对话风格共用渲染）
  const pendingQuestions = useStore($pendingQuestions);

  // 切会话时清空待答提问（引擎提问属于具体会话，避免跨会话悬浮 + 回答错 rpcId）
  useEffect(() => {
    setPendingQuestions(null);
  }, [activeId]);

  // 提问卡过期兜底：引擎侧 question 桥 5 分钟超时后回答已无意义，
  // UI 每 30s 检查一次、超时清卡（此前卡片可能永久悬挂）
  useEffect(() => {
    const t = window.setInterval(dropExpiredQuestions, 30_000);
    return () => window.clearInterval(t);
  }, []);

  // 队列自动排空（agent 空闲时自动发送排队消息）
  useQueueAutoDrain();
  // Todo 全部完成后自动消失
  useTodoAutoDismiss();
  // 后台进程自动消失（成功4s/失败12s）
  useBackgroundAutoDismiss();
  // 播种模拟数据（演示用，接真实后端后删除）
  useMockStatus();

  // 设置页模型/端点/密钥变化即时同步引擎目录（不等切会话）：否则新配的模型
  // 在 sidecar catalog 里不存在，发送时会被静默回退成默认 deepseek
  const providerConfigs = useStore($providerConfig);
  useEffect(() => {
    if (MOCK) return;
    void invoke("sync_provider_config", { configs: providerConfigs }).catch(() => {});
  }, [providerConfigs]);

  // dsh 引擎会话映射（唯一后端，所有对话风格共用）——串行流水线，三个触发源
  // （切会话 / 切左栏模式=切工作环境 / 设置页改环境信息）都走同一条干净切换：
  //   1) dsh_set_env  环境隔离（envId 会话命名空间 + 工作区 cwd）
  //   2) sync_provider_config 设置页配置进引擎目录
  //   3) load_dsh_session 会话映射（"<envId>::<会话id>" → dsh 会话）
  //   4) dsh_get_history 回放（含工具行/压缩标记灌 store）
  const envVer = useStore($envVersion);
  const selectedProjectId = useStore($selectedProjectId);
  const selectedProject = useStore($projects).find((p) => p.id === selectedProjectId) ?? null;
  // 画廊选中的带自定义工作区项目 → 专属引擎环境（cwd 隔离，和 dsh 一样）；
  // 无 cwd 项目或未选择 → 跟随视图默认环境。
  // useMemo：projectEnv 是切换 effect 的依赖——任何渲染都新建对象会让流水线
  // （set_env→load_session→reset→history）在每次无关重渲染时整跑一遍
  const projectEnv = useMemo(
    () =>
      selectedProject?.cwd
        ? { id: `project-${selectedProject.id}`, name: selectedProject.name, cwd: selectedProject.cwd }
        : null,
    [selectedProject?.id, selectedProject?.cwd, selectedProject?.name],
  );
  const envId = envIdForView(activeView);
  // 环境插件可见性联动：当前激活环境被隐藏 → 派发切换事件回主环境
  const envListForVisibility = useStore($environments);
  useEffect(() => {
    const env = envListForVisibility.find((e) => e.id === envId);
    if (env && env.visible === false) {
      window.dispatchEvent(new CustomEvent("mirach:switch-view", { detail: "mirach" }));
    }
  }, [envId, envListForVisibility]);
  useEffect(() => {
    if (MOCK) return;
    let alive = true;
    const env = projectEnv ?? envById(envId);
    // 会话表按环境真隔离：切换环境 → $sessions 载入该环境的独立会话分片
    setSessionsEnv(env.id);
    // 成员列表同样按环境分片（聊天环境的团队 ≠ 其他环境）
    setAgentsEnv(env.id);
    // 历史重放请求序号：只接受最后一次切会话/切环境的结果（防旧请求晚返回覆盖）
    const historySeq = ++historyReqSeq.current;
    (async () => {
      try {
        // 主聊天 persona：默认成员（奎木狼）或用户设置的默认成员的 systemPrompt
        const members = $agents.get();
        const persona = members.find((a) => a.id === ($defaultAgent.get() || DEFAULT_TEAM_ID))?.systemPrompt;
        await invoke("dsh_set_env", { envId: env.id, cwd: env.cwd || null, systemPrompt: persona ?? null });
      } catch {
        /* 环境下发失败不阻断会话加载 */
      }
      if (!alive || historySeq !== historyReqSeq.current) return;
      try {
        await invoke("sync_provider_config", { configs: $providerConfig.get() });
      } catch {
        /* ignore */
      }
      if (!alive || historySeq !== historyReqSeq.current) return;
      try {
        await invoke("load_dsh_session", { sessionId: activeId });
      } catch {
        /* ignore */
      }
      if (!alive || historySeq !== historyReqSeq.current) return;
      // 切会话/切环境：原始事件日志 + 装配引擎（时间线/四投影）一并复位，
      // 再由 get_history 的历史事件重建（官方投影=会话级累计，跨会话必须清零）
      resetRawEvents();
      try {
        const r = await invoke<{
          messages?: Parameters<typeof loadLiveHistory>[0];
          events?: { seq: number; type: string; data: unknown; time?: number }[];
        }>("dsh_get_history", { sessionId: activeId });
        if (!alive || historySeq !== historyReqSeq.current) return;
        const msgs = r?.messages ?? [];
        // 历史原始事件先于消息落装配引擎（整批 O(n) 去重，与实时流重叠安全）
        pushRawEvents(r?.events ?? []);
        // 整组替换即含清空（空历史=清空，杜绝上一会话残留）；空判断只为内容标记
        loadLiveHistory(msgs);
        if (msgs.length > 0) markSessionContent(activeId);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, envId, envVer, projectEnv]);

  // 拖拽调整终端高度（标准分隔条语义：向哪边拖，哪边收缩）
  // 手柄在终端上方：往下拖（dy>0）→ 终端变小、对话区变大
  const dragTerminal = (dy: number) =>
    setTerminalH((h) => Math.max(MIN_TERMINAL, Math.min(h - dy, MAX_TERMINAL)));
  // 稳定回调（Composer 已 memo，回调必须引用稳定才不会破坏 memo）
  const toggleTerminal = useCallback(() => setTerminalOpen((v) => !v), []);

  // 6 个 Mirach 环境（hermes 主环境 + chat/code/work/finance/write 5 模式）对应独立环境：
  // 切换模式 = 切换环境身份（左侧栏团队名联动），主内容区保持对话区。
  // 仅工具类视图（收藏/知识库等）渲染专属视图页。
  const viewPage = activeView === "mirach" || activeView === "chat" || activeView === "code" || activeView === "work" || activeView === "finance" || activeView === "write"
    ? null
    : activeView;

  return (
    // 主面板【不建】isolate 层叠上下文：isolate 会把整个面板压到 z-0 层，搜索框(z-50)/
    // 展开按钮等头部控件会沉到 TopBar(z-10) 下面无法点击（Tauri 下 TopBar 拦截点击）。
    // E3E6EC 背景用 z-0 + 内容 relative（DOM 靠后绘制在上）实现"内容盖背景"。
    <main className={cn("relative flex shrink-0 flex-col bg-white pb-5", className)} style={style}>
      {/* 底层背景容器（上下各留 20 空白、20 圆角）：E3E6EC 叠加层。
          浅色 80%；深色 5%（几乎隐形） */}
      <div
        className="pointer-events-none absolute rounded-[20px] bg-[#E3E6EC] opacity-80 dark:opacity-5"
        style={{
          top: 20,
          bottom: 20,
          left: 0,
          right: 0,
          zIndex: 0,
        }}
      />
      <HeaderSection width={mainW} showLeft={showLeft} onExpandLeft={onExpandLeft ?? (() => {})} palette={palette} />
      {/* Ctrl+O 切换反馈（短暂 toast，用户在任何位置按下都能看到反应） */}
      {detailsToast && (
        <div className="pointer-events-none absolute left-1/2 top-16 z-40 -translate-x-1/2 rounded-full bg-[#303030]/90 px-3 py-1 text-xs text-white shadow-md">
          {detailsExpanded ? "详细模式：开（Ctrl+O 切换）" : "详细模式：关"}
        </div>
      )}
      {/* 内容容器 relative：盖住背景（同层 z-0，DOM 靠后绘制在上） */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {viewPage ? (
          <ViewPage view={viewPage} />
        ) : (
          <>
            {/* 会话多标签条（S3-4：打开/关闭/切换/拖拽排序；可被聊天记录工具按钮隐藏） */}
            {showTabs && <SessionTabs />}
            {/* 引擎提问卡（所有对话风格共用：zosma 档也要能回答，否则引擎永久等待） */}
            {pendingQuestions && (
              <div className="relative z-20 mx-auto w-full px-5 py-2">
                <UserQuestionCard batch={pendingQuestions} />
              </div>
            )}
            {/* 简约对话档：zosma ChatView 全套（自带 MessageInput），
               替换现有消息区 + Composer + 终端（终端仅默认/dsh 档使用）。
               dsh 档走自己的渲染（ChatSection flat 行式 + dsh ReasoningRow），
               不再复用 zosma。 */}
            {chatStyle === "minimal" ? (
              <ZosmaChat sessionId={activeId} sessionTitle={activeTitle} />
            ) : (
              <div className="relative flex min-h-0 flex-1 flex-col">
                <ChatSection detailsExpanded={detailsExpanded} onToggleDetails={toggleDetails} />
                <Composer
                  terminalOpen={terminalOpen}
                  onToggleTerminal={toggleTerminal}
                />
                {/* 会话统计条：输入框底部以下 20px 内、宽度跟随输入框限宽居中
                    （对齐官方 composer.dock；pointer-events-none 不挡交互；
                    对话区变窄时 StatsLine 自带省略号 + 悬停全文） */}
                <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex h-5 items-center justify-center overflow-hidden px-5">
                  <div className="w-full min-w-0" style={{ maxWidth: "var(--chat-composer-max-width, 852px)" }}>
                    <StatsLine msgs={[]} />
                  </div>
                </div>
                <ResizeHandle onDrag={dragTerminal} />
                {terminalOpen && <TerminalPanel height={terminalH} onClose={() => setTerminalOpen(false)} />}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
