/**
 * LeftSidebar — 左侧栏 (280px)
 *
 * 内容从上到下：
 * ┌──────────────────────────┐
 * │  Chat Mirach      [◀▶]  │  header 85px（视图标题 + 收放按钮）
 * ├──────────────────────────┤
 * │      ┌──────┐           │
 * │ 30px │  CH  │ ◉ 状态    │  团队头像 80px
 * │      └──────┘    ● 连接  │  - 右上：生成中/已完成/未完成（无背景图标）
 * │  聊天智能体团队           │  - 右下：连接状态点（绿/灰）
 * │  功能描述文字             │
 * │     8    │    24        │  成员数 / 对话数（数字在上，文字在下）
 * │    成员   │   对话        │
 * │ ─────────────────────── │
 * │ [全部] [已读] [未读]      │  标签页切换
 * │ ─────────────────────── │
 * │ ┌──┬──────────────┬──┐  │
 * │ │AC│ Alice Chen   │  │  │  成员对话列表
 * │ │  │ 预览文字…     │时│  │  - 头像(36px) + 连接点
 * │ │  │              │态│  │  - 名称(text-member 15px)
 * │ └──┴──────────────┴──┘  │  - 预览+时间+状态图标
 * └──────────────────────────┘
 */

import { cn } from "@/lib/utils";
import { HeaderRule } from "@/components/layout/HeaderRule";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  PanelLeftClose,
  Check,
  Circle,
  Loader2,
  UserRound,
  MessageCircle,
  ChevronDown,
  ChevronRight,
  Search as SearchIcon,
  FilePlus,
  Package,
  Columns3,
  Clock,
  Pin,
  FolderKanban,
  FolderPlus,
} from "lucide-react";
import { useEffect, useLayoutEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@nanostores/react";
import { CustomScrollbar } from "@/components/ui/CustomScrollbar";
import {
  $sessions,
  createSession,
  renameSession,
  togglePin,
  archiveSession,
  restoreSession,
  deleteSession,
  exportSession,
  upsertEngineSession,
  markSessionContent,
  hasSessionContent,
  type SessionItem,
} from "@/store/sessions";
import { envIdForView } from "@/store/environments";
import { setActiveSession } from "@/store/session";
import {
  Archive,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Fingerprint,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
  Waypoints,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { openSessionWindow } from "@/lib/sessionWindow";
import { openTab, $suppressTabOnce } from "@/store/open-tabs";
import { useAppConfig } from "@/hooks/useAppConfig";
import { $projects, createProject } from "@/store/projects";
import { $agents, type ConvItem } from "@/store/agents";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { newTaskSession } from "@/store/chat";
import { requestTrajectory } from "@/store/chat-history";
import { openPrompt } from "@/store/prompt-dialog";
import type { SessionHit } from "@/lib/api/types";

// ===== View config =====

interface ViewConfig {
  label: string;
  team: string;
  desc: string;
  initials: string;
  avatarBg: string;
}

const viewConfigs: Record<string, ViewConfig> = {
  mirach:     { label: "Mirach",        team: "Mirach 主环境团队",   desc: "全能个人助理 · 六模式之根 · 全局协作",  initials: "HM", avatarBg: "#303030" },
  chat:       { label: "Chat Mirach",   team: "聊天智能体团队", desc: "智能对话 · 实时翻译 · 情感分析",     initials: "CH", avatarBg: "#6366F1" },
  code:       { label: "Code Mirach",   team: "代码智能体团队", desc: "代码生成 · 审查 · 重构 · 调试",       initials: "CD", avatarBg: "#F59E0B" },
  work:       { label: "Work Mirach",   team: "工作智能体团队", desc: "任务管理 · 日程安排 · 文档处理",     initials: "WK", avatarBg: "#10B981" },
  finance:    { label: "Finance Mirach",team: "金融智能体团队", desc: "数据分析 · 风险评估 · 市场预测",     initials: "FN", avatarBg: "#EF4444" },
  write:      { label: "Write Mirach",  team: "写作智能体团队", desc: "文案创作 · 内容优化 · 多语翻译",     initials: "WR", avatarBg: "#8B5CF6" },
  bookmarks:  { label: "Bookmarks",     team: "收藏智能体团队", desc: "知识收藏 · 标签管理 · 智能检索",     initials: "BM", avatarBg: "#EC4899" },
  cron:       { label: "Cron Mirach",   team: "定时任务团队",   desc: "自动化调度 · 定时执行 · 监控告警",   initials: "CR", avatarBg: "#06B6D4" },
  settings:   { label: "Settings",      team: "设置智能体团队", desc: "系统配置 · 个性化定制 · 安全管理",   initials: "ST", avatarBg: "#64748B" },
  messaging:  { label: "Messaging",     team: "通讯智能体团队", desc: "消息管理 · 多渠道接入 · 智能回复",   initials: "MS", avatarBg: "#14B8A6" },
  knowledge:  { label: "Knowledge",     team: "知识库智能体团队", desc: "知识管理 · 智能检索 · 自动归纳",   initials: "KN", avatarBg: "#F97316" },
  commands:   { label: "Commands",      team: "命令中心团队",   desc: "快捷指令 · 批量操作 · 系统控制",     initials: "CM", avatarBg: "#3B82F6" },
  extensions: { label: "Extensions",    team: "拓展智能体团队", desc: "插件管理 · 功能扩展 · 第三方集成",   initials: "EX", avatarBg: "#84CC16" },
};

function getConfig(view: string): ViewConfig {
  return viewConfigs[view] ?? { label: `${view}`, team: `${view} 团队`, desc: "", initials: view.slice(0, 2).toUpperCase(), avatarBg: "#6366F1" };
}

// ===== Status badge =====

type AgentStatus = "generating" | "completed" | "pending";

function SpeakingDots() {
  return (
    <div className="flex items-center gap-[3px]">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block rounded-full bg-[#F59E0B]"
          style={{
            width: 5,
            height: 5,
            animation: `speaking-bounce 0.8s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStatus }) {
  return (
    <div
      className="absolute -top-2 -right-2 flex items-center justify-center"
      style={{ width: 24, height: 24 }}
    >
      {status === "generating" && <SpeakingDots />}
      {status === "completed" && <Check className="h-5 w-5 text-[#10B981]" strokeWidth={2.5} />}
      {status === "pending" && <Circle className="h-4 w-4 text-[#9CA3AF]" strokeWidth={2.5} />}
    </div>
  );
}

// ===== Mini status icon for list items =====

function MiniStatus({ status }: { status: AgentStatus }) {
  if (status === "generating") return <Loader2 className="h-3.5 w-3.5 text-[#F59E0B] animate-spin" strokeWidth={2.5} />;
  if (status === "completed") return <Check className="h-3.5 w-3.5 text-[#10B981]" strokeWidth={2.5} />;
  return <Circle className="h-3.5 w-3.5 text-[#9CA3AF]" strokeWidth={2.5} />;
}

// ===== 智能体（团队成员）：数据源在 store/agents（可添加/修改/删除） =====

// 类型由 store 提供，re-export 保持旧 import 兼容（MemberChatPanel 等）
export type { ConvItem } from "@/store/agents";

// ===== Mock sessions（已迁移到 store/sessions.ts，保留仅作参考） =====

// ===== Mock projects（已迁移到 store/projects.ts） =====

// 会话时间显示：今天 → HH:MM，否则 M/D
function fmtSessionTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// FTS snippet：转义 HTML 后保留 <mark> 高亮标签（防止会话内容里的 HTML 注入）
function highlightSnippet(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/&lt;mark&gt;/g, "<mark>")
    .replace(/&lt;\/mark&gt;/g, "</mark>");
}

// ===== Component =====

interface LeftSidebarProps {
  className?: string;
  activeView?: string;
  onCollapse?: () => void;
  /** 左侧栏宽度（px，默认 280，可拖拽调节） */
  width?: number;
  /** 点击团队成员时回调（打开与该成员的对话） */
  onSelectMember?: (member: ConvItem) => void;
  /** 当前选中的成员 id（用于常亮高亮） */
  selectedMemberId?: string | null;
  /** 左侧"产物"按钮 → 打开右侧栏产物面板 */
  onOpenArtifacts?: () => void;
  /** 左侧"定时任务"按钮 → 打开排程弹窗 */
  onOpenCron?: () => void;
  /** 左侧"看板"按钮 → 打开看板 */
  onOpenKanban?: () => void;
}

export function LeftSidebar({
  className,
  activeView = "chat",
  onCollapse,
  width = 280,
  onSelectMember,
  selectedMemberId = null,
  onOpenArtifacts,
  onOpenCron,
  onOpenKanban,
}: LeftSidebarProps) {
  const cfg = getConfig(activeView);
  // 当前模式的 hermes 数据文件夹名（会话列表"项目"归属文件夹；随模式切换）：
  // 主环境 = .myhermes 根（hermes），5 档案 = .myhermes/profiles/<view>（hermes-<view>）
  const viewFolder = activeView === "mirach" ? "mirach" : `mirach-${activeView}`;
  // 工作区/数据目录（会话右键菜单"在资源管理器中打开 / 复制路径 / 复制日志路径"用）
  const { config } = useAppConfig();
  const [activeTab, setActiveTab] = useState<"all" | "read" | "unread">("all");
  const [viewMode, setViewMode] = useState<"team" | "sessions">("team");
  const [sessionTab, setSessionTab] = useState<"conv" | "member">("conv");
  const [searchQuery, setSearchQuery] = useState("");
  // 会话操作菜单（当前打开菜单的会话 id + 固定定位；右键/⋯ 共用）
  // menuTitle：项目树会话可能尚无 store 会话（不主动创建），仅记录标题供延迟创建
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuTitle, setMenuTitle] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  // 当前选中的会话 id（普通点击高亮 + 设为活跃会话）
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  // 菜单钳制到软件面板内：透明窗口比面板大（各 40px 边距），按窗口/视口钳制会把菜单
  // 推进透明边距并被窗口边缘截断；改为记录面板视口矩形 + 菜单实际高度，钳制在面板内
  const [panelRect, setPanelRect] = useState<{ l: number; t: number; r: number; b: number } | null>(null);
  const [menuH, setMenuH] = useState(320);
  const menuRef = useRef<HTMLDivElement>(null);

  // 真实模式：会话列表来自 dsh 引擎（磁盘目录扫描 + 首条用户消息做标题）；
  // 搜索走本地过滤（引擎 FTS5 是旧 hermes 面，未接）
  const isReal = !MOCK && getApi().mode === "real";

  /** 前端会话 id → 磁盘 dsh 会话 id（导入时记录；点击时先采纳映射再切换） */
  const engineDshRef = useRef(new Map<string, string>());

  // 挂载/切视图时拉取引擎持久化会话：只并入【当前环境】有映射的条目——
  // 纯孤儿日志环境不明，混进列表会造成跨环境污染
  useEffect(() => {
    if (!isReal) return;
    const curEnv = envIdForView(activeView);
    void invoke<{ sessions?: { id: string; createdAt?: number; title?: string; frontendId?: string; envId?: string }[] }>(
      "dsh_list_sessions",
    )
      .then((r) => {
        for (const s of r?.sessions ?? []) {
          if (!s.frontendId || (s.envId && s.envId !== curEnv)) continue;
          const createdAt = s.createdAt || Date.now();
          upsertEngineSession({
            id: s.frontendId,
            title: s.title?.trim() || "历史会话",
            preview: "",
            time: fmtSessionTime(createdAt),
            pinned: false,
            archived: false,
            createdAt,
          });
          markSessionContent(s.frontendId);
          engineDshRef.current.set(s.frontendId, s.id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReal, activeView]);

  // 真实模式：会话全文搜索结果（FTS5，防抖 250ms）
  const [realHits, setRealHits] = useState<SessionHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  useEffect(() => {
    if (!isReal || !searchQuery.trim()) {
      setRealHits([]);
      setHitsLoading(false);
      return;
    }
    setHitsLoading(true);
    const t = window.setTimeout(() => {
      void getApi()
        .searchSessions(searchQuery.trim())
        .then((h) => {
          setRealHits(h);
          setHitsLoading(false);
        })
        .catch(() => {
          setRealHits([]);
          setHitsLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(t);
  }, [isReal, searchQuery]);

  // 真实模式打开历史会话：设活跃会话 → MainPanel 的 dsh_get_history effect
  // 统一回放（含空会话清空），避免与这里的 loadLiveHistory 双路径竞争覆盖
  const openSearchHit = async (h: SessionHit) => {
    setSelectedSessionId(h.sessionId);
    setActiveSession(h.sessionId);
  };

  /** 会话行点击：原型修饰键语义
   *  - 普通点击 → in-place：选中该会话并设为活跃会话（主对话区 / per-session 状态跟随）
   *  - ⌘/⌃+点击 → tab：设为活跃会话，SessionTabs 自动补开标签
   *  - ⇧⌘/⇧⌃+点击 → window：新窗口打开（open_session_window 未注册时静默）
   */
  const handleSessionClick = (e: React.MouseEvent, s: SessionItem) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey) {
      e.preventDefault();
      openSessionWindow(s.id);
      return;
    }
    setSelectedSessionId(s.id);
    if (mod) {
      // ⌘/⌃+点击 = 标签意图：显式补开标签（普通点击 in-place 切换，不开标签）
      openTab(s.id);
    } else {
      $suppressTabOnce.set(true);
    }
    // 引擎磁盘历史：先采纳 "<env>::<前端id>" → 已有 dsh 会话的映射（否则
    // MainPanel 流水线会新建空会话丢上下文），再切换活跃会话触发统一回放
    const dsh = engineDshRef.current.get(s.id);
    if (dsh) {
      void invoke("load_dsh_session", { sessionId: s.id, dshSessionId: dsh }).catch(() => {});
    }
    // 历史回放由 MainPanel 的 dsh_get_history effect 统一处理（切会话清空 +
    // 按 dsh 日志回放）；这里不再 loadSession/loadLiveHistory，避免双路径竞争
    setActiveSession(s.id);
  };

  // 会话列表（store，本地持久化）
  const sessions = useStore($sessions);
  const pinnedSessions = sessions.filter((s) => s.pinned && !s.archived);
  const archivedSessions = sessions.filter((s) => s.archived);
  // 项目树（store，本地持久化）
  const projects = useStore($projects);
  const convList = sessions
    .filter((s) => !s.archived)
    // 对齐 dsh：空白会话从列表隐藏（复用入口 = 新建任务），只显示有内容的会话
    .filter((s) => hasSessionContent(s.id))
    .filter((s) => !searchQuery || (s.title ?? "").includes(searchQuery) || (s.preview ?? "").includes(searchQuery));

  // ---- 自定义滚动条目标容器 ----
  const sessionBodyRef = useRef<HTMLDivElement>(null);
  const teamBodyRef = useRef<HTMLDivElement>(null);

  const conversations = useStore($agents).filter(
    (c) => activeTab === "all" || c.tab === activeTab,
  );

  // ---- 打开会话操作菜单（右键 / ⋯ 按钮共用）：记录会话 + 鼠标位置 ----
  const openSessionMenu = (e: React.MouseEvent, s: SessionItem | null, title?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuFor((m) => (s && m === s.id ? null : s?.id ?? null));
    setMenuTitle(title ?? null);
    setMenuPos({ x: e.clientX, y: e.clientY });
    // 记录软件面板视口矩形（菜单按面板钳制，不按窗口：窗口有 40px 透明边距）
    const pr = document.querySelector("[data-panel]")?.getBoundingClientRect();
    setPanelRect(pr ? { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom } : null);
  };
  // 菜单渲染后按实际高度钳制（useLayoutEffect 在绘制前跑，位置修正不闪烁）
  useLayoutEffect(() => {
    if (!menuPos) return;
    const el = menuRef.current;
    if (el) setMenuH(el.offsetHeight);
  }, [menuPos]);
  // 项目树会话没有 store id：右键时只查已存在的同名会话，不创建（副作用延迟到菜单操作）
  const resolveProjectSession = (title: string): SessionItem | null =>
    $sessions.get().find((s) => s.title === title) ?? null;
  // 当前菜单会话（供共享菜单渲染）。项目会话尚无 store 会话时以标题生成虚拟项，操作时再创建
  const menuSession = menuFor
    ? sessions.find((s) => s.id === menuFor) ?? null
    : menuTitle
      ? sessions.find((s) => s.title === menuTitle) ??
        ({ id: "", title: menuTitle, preview: "", time: "", pinned: false, archived: false } as SessionItem)
      : null;
  // 菜单操作真正需要 store 会话时再解析：已存在直接返回，否则延迟创建（一次右键只建一个）
  const ensureMenuSession = (): SessionItem | null => {
    if (menuSession && menuSession.id) return menuSession;
    if (!menuTitle) return null;
    const found = $sessions.get().find((s) => s.title === menuTitle);
    return found ?? createSession(menuTitle);
  };

  // ===== Session list view =====
  if (viewMode === "sessions") {
    return (
      <aside
        className={cn("relative flex flex-col shrink-0 grow-0 bg-white overflow-hidden", className)}
        style={{ width, minWidth: width, maxWidth: width }}
      >
        {/* Header */}
        <div
          className="relative flex items-center justify-between px-4 shrink-0"
          style={{ height: 85 }}
        >
          <HeaderRule />
          <div className="flex flex-col gap-1 min-w-0">
            <button
              onClick={() => setViewMode("team")}
              className="text-heading font-bold text-[#303030] leading-[1.4] text-left hover:opacity-80 transition-opacity"
            >
              {cfg.label}
            </button>
            <span className="text-body-sm text-muted-foreground leading-none">会话列表</span>
          </div>
          <button
            onClick={onCollapse}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
          >
            <PanelLeftClose className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>

        {/* Body：滚动容器外包 wrapper，滚动条固定不随内容滚动 */}
        <div className="relative flex-1 min-h-0">
          <div
            ref={sessionBodyRef}
            className="overflow-y-auto pb-[20px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            style={{ height: "calc(100% - 20px)" }}>
          <div
            className="flex flex-col items-stretch px-3 pt-3"
            style={{ maskImage: "linear-gradient(to bottom, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)" }}
          >

            {/* 新建任务 + 产物 + 看板 + 定时任务 (竖向排列) */}
            <div className="flex flex-col gap-1 mb-3">
              {([
                {
                  label: "新建任务",
                  icon: FilePlus,
                  shortcut: "Ctrl+N",
                  action: () => {
                    // dsh New Session 语义：空白会话复用（不每次新建堆积空会话）；
                    // 有内容才新建。激活后 MainPanel 切会话统一清空 + 回放历史
                    setActiveSession(newTaskSession());
                    setSessionTab("conv");
                  },
                },
                { label: "产物", icon: Package, shortcut: undefined, action: () => onOpenArtifacts?.() },
                { label: "看板", icon: Columns3, shortcut: undefined, action: () => onOpenKanban?.() },
                { label: "定时任务", icon: Clock, shortcut: undefined, action: () => onOpenCron?.() },
              ] as { label: string; icon: typeof FilePlus; shortcut?: string; action?: () => void }[]).map(({ label, icon: Icon, shortcut, action }) => (
                <button
                  key={label}
                  onClick={action}
                  className="flex items-center gap-[16px] w-full rounded-lg py-1.5 text-member text-[#303030] hover:bg-muted transition-colors text-left"
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                  <span className="flex-1">{label}</span>
                  {shortcut && <span className="text-body-sm text-muted-foreground">{shortcut}</span>}
                </button>
              ))}
            </div>

            {/* 搜索 */}
            <div className="relative mb-3">
              <input
                className="w-full rounded-lg border border-border bg-white pl-8 pr-3 py-1.5 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
                placeholder="搜索会话..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            </div>

            {/* 已置顶会话（.dropdown-card 令牌 = zosma CustomProviderRow 卡片样式：
                头部按钮 + 旋转 ChevronDown + borderTop 内容区；改令牌即全局换样式） */}
            <div className="dropdown-card mb-3">
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="dropdown-card-trigger py-1.5 group/pinned">
                  <Pin className="dropdown-card-icon" strokeWidth={2} />
                  <span className="flex-1 text-left text-member">已置顶会话</span>
                  <ChevronDown className="dropdown-card-chevron group-data-[state=open]/pinned:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="dropdown-card-body px-2 pb-1.5">
                    {/* Hint */}
                    <p className="mt-1 mb-1 px-2 text-[11px] text-muted-foreground/60">
                      Shift+单击对话以置顶 · 拖动以重新排序
                    </p>
                    {pinnedSessions.length === 0 ? (
                      <p className="px-2 py-1 text-body-sm text-muted-foreground/60">暂无置顶会话</p>
                    ) : (
                      pinnedSessions.map((s) => (
                        <div
                          key={s.id}
                          onClick={(e) => handleSessionClick(e, s)}
                          title="点击打开 · ⌘/⌃+点击打开标签 · ⇧⌘+点击新窗口"
                          onContextMenu={(e) => openSessionMenu(e, s)}
                          className="flex items-center gap-[16px] rounded-lg px-2 py-1.5 hover:bg-muted cursor-pointer transition-colors"
                        >
                          <Pin className="h-3 w-3 text-[#F59E0B] shrink-0" strokeWidth={2} fill="#F59E0B" />
                          <div className="flex-1 min-w-0">
                            <p className="text-body-sm text-[#303030] truncate">{s.title}</p>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">{s.time}</span>
                        </div>
                      ))
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* 项目（.dropdown-card 令牌 = zosma CustomProviderRow 卡片样式；改令牌即全局换样式） */}
            <div className="dropdown-card mb-3">
              <Collapsible defaultOpen>
                <CollapsibleTrigger className="dropdown-card-trigger py-1.5 group/pinned">
                  <FolderKanban className="dropdown-card-icon" strokeWidth={2} />
                  <span className="min-w-0 flex-1 truncate text-left text-member" title={`项目（${viewFolder}）`}>
                    项目<span className="text-muted-foreground">（{viewFolder}）</span>
                  </span>
                  <button
                    className="opacity-0 group-hover/pinned:opacity-100 transition-opacity hover:text-[#303030] text-muted-foreground"
                    title="新建项目"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const name = (await openPrompt({ title: "新建项目名称", initialValue: "新项目", confirmText: "创建" }))?.trim();
                      if (name) createProject(name);
                    }}
                  >
                    <FolderPlus className="h-4 w-4" strokeWidth={2} />
                  </button>
                  <ChevronDown className="dropdown-card-chevron group-data-[state=open]/pinned:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="dropdown-card-body space-y-0.5 p-1.5">
                    {projects.map((proj) => (
                      <Collapsible key={proj.id}>
                        <CollapsibleTrigger className="flex items-center gap-[16px] w-full rounded-lg py-1.5 px-2 hover:bg-muted data-[state=open]:bg-muted cursor-pointer group/proj">
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 group-data-[state=open]/proj:rotate-90" />
                          <span className="flex-1 min-w-0 truncate text-left text-body-sm text-[#303030]">{proj.name}</span>
                          <button
                            className="opacity-0 group-hover/proj:opacity-100 transition-opacity hover:text-[#303030] text-muted-foreground"
                            title="新建会话"
                            onClick={(e) => {
                              e.stopPropagation();
                              // 不弹标题输入：直接建空会话（中栏显示引导页）
                              createSession(`${proj.name} · 新会话`);
                              setSessionTab("conv");
                            }}
                          >
                            <FolderPlus className="h-3.5 w-3.5" strokeWidth={2} />
                          </button>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <div className="ml-8 pl-3 space-y-0.5">
                            {/* 项目专属目录说明 */}
                            <div className="flex items-center gap-1.5 py-1">
                              <FolderKanban className="h-3 w-3 shrink-0 text-muted-foreground" strokeWidth={2} />
                              <span className="min-w-0 truncate text-body-sm text-muted-foreground">
                                {viewFolder}-{proj.name.replace(/\s+/g, "")}
                              </span>
                            </div>
                            {/* Sessions（点击打开：有同名 store 会话直接激活；没有则创建并激活，
                                主页面标题/介绍跟随切换） */}
                            {proj.sessions.map((s, i) => (
                              <div
                                key={i}
                                onClick={(e) => {
                                  const store = resolveProjectSession(s.title);
                                  if (store) {
                                    handleSessionClick(e, store);
                                  } else {
                                    const created = createSession(s.title);
                                    setSelectedSessionId(created.id);
                                    setActiveSession(created.id);
                                    setSessionTab("conv");
                                  }
                                }}
                                onContextMenu={(e) => openSessionMenu(e, resolveProjectSession(s.title), s.title)}
                                className="flex items-center gap-2 rounded-lg py-1 pl-5 hover:bg-muted cursor-pointer transition-colors"
                              >
                                <span className="flex-1 text-body-sm text-[#303030] truncate">{s.title}</span>
                                <span className="text-[11px] text-muted-foreground shrink-0">{s.time}</span>
                              </div>
                            ))}
                          </div>
                        </CollapsibleContent>
                      </Collapsible>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>

            {/* Tabs: 对话 / 成员 */}
            <div className="flex items-center w-full">
              {(["conv", "member"] as const).map((tab, i) => {
                const labels = { conv: "所有会话", member: "成员" };
                const active = sessionTab === tab;
                return (
                  <span key={tab} className="flex items-center flex-1">
                    {i > 0 && <span className="w-px h-4 bg-border mr-2" />}
                    <button
                      onClick={() => setSessionTab(tab)}
                      className={cn("w-full py-1.5 font-medium transition-colors text-center", active ? "text-[#303030]" : "text-body-sm text-muted-foreground hover:text-[#464646]")}
                      style={active ? { fontSize: 15, fontWeight: 700 } : undefined}
                    >
                      {labels[tab]}
                    </button>
                  </span>
                );
              })}
            </div>

            {/* Separator */}
            <div className="w-full h-px bg-border mb-3" />

            {/* 真实模式：会话全文搜索结果（FTS5） */}
            {sessionTab === "conv" && isReal && searchQuery.trim() && (
              <div className="mb-2">
                {hitsLoading ? (
                  <p className="px-2 py-1 text-body-sm text-muted-foreground">搜索中…</p>
                ) : realHits.length > 0 ? (
                  realHits.map((h) => (
                    <div
                      key={`${h.sessionId}-${h.messageId}`}
                      onClick={() => void openSearchHit(h)}
                      title="打开该历史会话"
                      className="group relative flex flex-col gap-0.5 rounded-lg px-2 py-2 cursor-pointer transition-colors hover:bg-muted"
                    >
                      <div className="flex items-center gap-1">
                        <p className="text-member font-medium text-[#303030] truncate flex-1">{h.title}</p>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] uppercase text-muted-foreground">{h.role}</span>
                      </div>
                      <p
                        className="text-body-sm text-muted-foreground truncate"
                        dangerouslySetInnerHTML={{ __html: highlightSnippet(h.snippet) }}
                      />
                    </div>
                  ))
                ) : (
                  <p className="px-2 py-1 text-body-sm text-muted-foreground">没有匹配的会话内容</p>
                )}
              </div>
            )}

            {/* 当前活跃会话置顶：空白会话按 dsh 语义从列表隐藏，但"正在说话的
                这个"必须随时可见（否则新开会话找不到入口） */}
            {sessionTab === "conv" &&
              !convList.some((s) => s.id === selectedSessionId) &&
              selectedSessionId && (
                <div
                  onClick={(e) =>
                    handleSessionClick(e, {
                      id: selectedSessionId,
                      title: "当前对话",
                      preview: "",
                      time: "刚刚",
                      pinned: false,
                      archived: false,
                      createdAt: Date.now(),
                    })
                  }
                  className="flex flex-col gap-0.5 rounded-lg bg-muted px-2 py-2 cursor-pointer"
                >
                  <div className="flex items-center gap-1">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#2E5BFF]" />
                    <p className="text-member font-medium text-[#303030] truncate flex-1">当前对话</p>
                  </div>
                  <p className="text-body-sm text-muted-foreground">尚未命名（发送第一条消息后自动归入列表）</p>
                </div>
              )}
            {/* 对话列表 (带搜索过滤；hover 出现操作菜单：置顶/重命名/归档/导出/删除) */}
            {sessionTab === "conv" &&
              convList.map((s) => (
                <div
                  key={s.id}
                  onClick={(e) => handleSessionClick(e, s)}
                  title="点击打开 · ⌘/⌃+点击打开标签 · ⇧⌘+点击新窗口"
                  onContextMenu={(e) => openSessionMenu(e, s)}
                  className={cn(
                    "group relative flex flex-col gap-0.5 rounded-lg px-2 py-2 cursor-pointer transition-colors",
                    selectedSessionId === s.id ? "bg-muted" : "hover:bg-muted",
                  )}
                >
                  <div className="flex items-center gap-1">
                    <p title={s.title} className="text-member font-medium text-[#303030] truncate flex-1">{s.title}</p>
                    {s.pinned && (
                      <Pin className="h-3 w-3 shrink-0 text-[#F59E0B]" strokeWidth={2} fill="#F59E0B" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        // ⋯ 按钮：在按钮下方弹出共享菜单
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setMenuFor((m) => (m === s.id ? null : s.id));
                        setMenuPos({ x: r.right - 160, y: r.bottom + 4 });
                      }}
                      title="会话操作"
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-black/5 group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <p title={s.preview} className="text-body-sm text-muted-foreground truncate flex-1">{s.preview || "（空会话）"}</p>
                    <span className="text-[11px] text-muted-foreground shrink-0">{s.time}</span>
                  </div>
                </div>
              ))}
            {sessionTab === "conv" && convList.length === 0 && (
              <p className="px-2 py-4 text-center text-body-sm text-muted-foreground">
                {searchQuery ? "没有匹配的会话" : "暂无会话，点「新建任务」开始"}
              </p>
            )}

            {/* 成员列表（点击打开与该成员的对话，选中常亮；添加/编辑/删除在设置 → 智能体） */}
            {sessionTab === "member" &&
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  className={cn(
                    "group relative -mx-3 -my-[1px] flex w-[calc(100%+24px)] items-center gap-2.5 rounded-none pl-3 py-2 cursor-pointer transition-colors duration-50",
                    selectedMemberId !== conv.id && "hover:bg-muted",
                    selectedMemberId === conv.id && "bg-muted",
                  )}
                >
                  <div onClick={() => onSelectMember?.(conv)} className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
                      <div className="flex h-full w-full items-center justify-center rounded-full text-white text-[10px] font-bold" style={{ backgroundColor: conv.avatarBg }}>
                        {conv.initials}
                      </div>
                      <span className="absolute block rounded-full border-2 border-white" style={{ width: 11, height: 11, bottom: -2, right: -2, backgroundColor: conv.status === "pending" ? "#D1D5DB" : "#10B981" }} />
                    </div>
                    <span title={conv.name} className="text-member text-[#303030] flex-1 truncate max-w-[140px]">{conv.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{conv.time}</span>
                  </div>
                </div>
              ))}

            {/* 已归档会话（可恢复 / 彻底删除） */}
            {archivedSessions.length > 0 && (
              <Collapsible className="mt-3">
                <CollapsibleTrigger className="flex items-center gap-[16px] w-full py-0.5 cursor-pointer group/arch">
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                  <span className="flex-1 text-left text-member">
                    已归档<span className="text-muted-foreground">（{archivedSessions.length}）</span>
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-data-[state=open]/arch:rotate-180" />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-0.5 py-1">
                    {archivedSessions.map((s) => (
                      <div key={s.id} className="flex items-center gap-1 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted">
                        <span className="min-w-0 flex-1 truncate text-body-sm text-muted-foreground">{s.title}</span>
                        <button
                          onClick={() => restoreSession(s.id)}
                          title="恢复"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#303030]"
                        >
                          <RotateCcw className="h-3 w-3" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`彻底删除会话「${s.title}」？不可恢复。`)) deleteSession(s.id);
                          }}
                          title="彻底删除"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-black/5 hover:text-[#EF4444]"
                        >
                          <Trash2 className="h-3 w-3" strokeWidth={2} />
                        </button>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

          </div>
          </div>
          {/* 自定义滚动条（滚动容器外，固定） */}
          <CustomScrollbar scrollRef={sessionBodyRef} className="absolute right-1 top-2 bottom-[22px]" />

          {/* 共享会话操作菜单（右键/⋯ 打开；fixed 定位在鼠标/按钮旁）。
              Portal 到 body：卡片有 transform（拖拽缩放后）时，fixed 会相对卡片定位导致
              弹窗位置偏移，挂到 body 无 transform 祖先保证视口定位。 */}
          {menuSession && menuPos &&
            createPortal(
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => {
                    setMenuFor(null);
                    setMenuPos(null);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuFor(null);
                    setMenuPos(null);
                  }}
                />
                <div
                  ref={menuRef}
                  className="panel-glass menu-anim fixed z-50 w-44 rounded-xl py-1"
                  style={{
                    // 钳制在软件面板内（面板 1580×900 居中于 1660×980 透明窗口，
                    // 窗口/视口钳制会把菜单推进透明边距并被窗口边缘截断）
                    left: panelRect
                      ? Math.min(Math.max(menuPos.x, panelRect.l + 4), panelRect.r - 188 - 4)
                      : Math.min(menuPos.x, window.innerWidth - 188),
                    top: panelRect
                      ? Math.min(Math.max(menuPos.y, panelRect.t + 4), panelRect.b - menuH - 4)
                      : Math.min(menuPos.y, window.innerHeight - 320),
                  }}
                >
                {[
                  { label: menuSession.pinned ? "取消置顶" : "置顶", icon: Pin, run: () => { const s = ensureMenuSession(); if (s) togglePin(s.id); } },
                  { label: "在新窗口打开", icon: ExternalLink, run: () => { const s = ensureMenuSession(); if (s) openSessionWindow(s.id); } },
                  { label: "重命名", icon: Pencil, run: async () => {
                    const s = ensureMenuSession();
                    if (!s) return;
                    const t = (await openPrompt({ title: "重命名会话", initialValue: s.title, confirmText: "重命名" }))?.trim();
                    if (!t) return;
                    if (isReal) void getApi().renameSession(s.id, t).catch(() => {});
                    renameSession(s.id, t);
                  } },
                  { label: "归档", icon: Archive, run: () => { const s = ensureMenuSession(); if (s && window.confirm(`归档会话「${s.title}」？可从 store 恢复。`)) archiveSession(s.id); } },
                  { label: "导出 JSON", icon: Download, run: () => { const s = ensureMenuSession(); if (s) exportSession(s.id); } },
                  // 分隔线
                  null,
                  { label: "在资源管理器中打开", icon: FolderOpen, run: () => { const p = config.workspace; if (p) void invoke("reveal_path", { path: p }).catch(() => {}); } },
                  { label: "复制路径", icon: Copy, run: () => void navigator.clipboard.writeText(config.workspace || "").catch(() => {}) },
                  { label: "复制任务路径", icon: FileText, run: () => void navigator.clipboard.writeText(config.workspace || "").catch(() => {}) },
                  { label: "复制日志路径", icon: FileCode, run: () => void navigator.clipboard.writeText(config.dataDir || "").catch(() => {}) },
                  { label: "复制会话 ID", icon: Fingerprint, run: () => { const s = ensureMenuSession(); if (s) void navigator.clipboard.writeText(s.id).catch(() => {}); } },
                  { label: "查看调用轨迹", icon: Waypoints, run: () => { requestTrajectory(); } },
                  // 分隔线
                  null,
                  { label: "删除", icon: Trash2, danger: true, run: () => {
                    const s = ensureMenuSession();
                    if (!s) return;
                    if (!window.confirm(`彻底删除会话「${s.title}」？不可恢复。`)) return;
                    if (isReal) void getApi().deleteSession(s.id).catch(() => {});
                    deleteSession(s.id);
                  } },
                ].map((item, idx) =>
                  item === null ? (
                    <div key={`sep-${idx}`} className="mx-2 my-1 h-px bg-border" />
                  ) : (
                    <button
                      key={item.label}
                      onClick={() => {
                        setMenuFor(null);
                        setMenuTitle(null);
                        setMenuPos(null);
                        item.run();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm transition-colors hover:bg-muted",
                        "danger" in item && item.danger ? "text-red-500" : "text-[#303030]",
                      )}
                    >
                      <item.icon className="h-3.5 w-3.5" strokeWidth={2} />
                      {item.label}
                    </button>
                  ),
                )}
                </div>
              </>,
              document.body,
            )}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "relative flex flex-col shrink-0 grow-0 bg-white overflow-hidden",
        className,
      )}
      style={{ width, minWidth: width, maxWidth: width }}
    >
      {/* ===== Header (85px) ===== */}
      <div
        className="relative flex items-center justify-between px-4 shrink-0"
        style={{ height: 85 }}
      >
        <HeaderRule />
        <div className="flex flex-col gap-1 min-w-0">
          <button
            onClick={() => setViewMode(viewMode === "team" ? "sessions" : "team")}
            className="text-heading font-bold text-[#303030] leading-[1.4] text-left hover:opacity-80 transition-opacity"
          >
            {cfg.label}
          </button>
          <span className="text-body-sm text-muted-foreground leading-none">
            团队列表
          </span>
        </div>
        <button
          onClick={onCollapse}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
        >
          <PanelLeftClose className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>

      {/* ===== Body ===== */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={teamBodyRef}
          className="overflow-y-auto overflow-x-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ height: "calc(100% - 20px)" }}
        >
        <div
          className="flex flex-col items-stretch px-3 pt-[30px]"
          style={{ maskImage: "linear-gradient(to bottom, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)" }}
        >
          {/* Avatar + status */}
          <div className="relative mb-4 self-center" style={{ width: 80, height: 80 }}>
            <div
              className="flex h-full w-full items-center justify-center rounded-full text-white font-bold text-2xl"
              style={{ backgroundColor: cfg.avatarBg }}
            >
              {cfg.initials}
            </div>
            {/* Top-right: agent status */}
            <StatusBadge status="generating" />
            {/* Bottom-right: connection dot */}
            <span
              className="absolute block rounded-full border-[3px] border-white"
              style={{ width: 18, height: 18, bottom: -5, right: -5, backgroundColor: "#10B981" }}
            />
          </div>

          {/* Team name */}
          <p className="text-subheading text-[#303030] text-center">{cfg.team}</p>

          {/* Description */}
          <p className="text-body-sm text-muted-foreground text-center mt-1 leading-relaxed">
            {cfg.desc}
          </p>

          {/* Members + Conversations（图标 + 数字，数字在图标后面）
              真实计数：成员 = $agents 本列表；会话 = 当前视图的非归档会话数。
              此前写死 8 / 24。 */}
          <div className="flex items-center justify-center gap-6 mt-4 self-center">
            <div className="flex items-center gap-1.5">
              <UserRound className="h-4 w-4 text-[#303030]" strokeWidth={2} />
              <span className="text-lg font-bold text-[#303030] leading-none">{conversations.length}</span>
            </div>
            <div className="w-px h-10 bg-border" />
            <div className="flex items-center gap-1.5">
              <MessageCircle className="h-4 w-4 text-[#303030]" strokeWidth={2} />
              <span className="text-lg font-bold text-[#303030] leading-none">
                {sessions.filter((s) => !s.archived && hasSessionContent(s.id)).length}
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="w-full h-px bg-border my-4" />

          {/* ===== Tabs: 全部 / 已读 / 未读 ===== */}
          <div className="flex items-center w-full mb-3">
            {(["all", "read", "unread"] as const).map((tab, i) => {
              const labels = { all: "全部", read: "已读", unread: "未读" };
              const active = activeTab === tab;
              return (
                <span key={tab} className="flex items-center flex-1">
                  {i > 0 && <span className="w-px h-4 bg-border mr-2" />}
                  <button
                    onClick={() => setActiveTab(tab)}
                    className={cn(
                      "w-full py-1.5 font-medium transition-colors text-center",
                      active
                        ? "text-[#303030]"
                        : "text-body-sm text-muted-foreground hover:text-[#464646]",
                    )}
                    style={active ? { fontSize: 15, fontWeight: 700 } : undefined}
                  >
                    {labels[tab]}
                  </button>
                </span>
              );
            })}
          </div>

          {/* ===== Conversation list ===== */}
          <div className="space-y-0.5" style={{ width: width - 24 }}>
            {conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => onSelectMember?.(conv)}
                className={cn(
                  // 行宽扩展到容器全宽（-12px 抵消容器 padding），pl-3 保持内容位置不变
                  // -my-[1px] 上下各延伸 1px，盖住行间距，高亮条无缝连续
                  "-mx-3 -my-[1px] flex w-[calc(100%+24px)] items-center gap-2 rounded-none pl-3 py-2 cursor-pointer transition-colors duration-50",
                  // 悬停/选中均为左右贴边、无圆角样式
                  selectedMemberId !== conv.id && "hover:bg-muted",
                  selectedMemberId === conv.id && "bg-muted",
                )}
              >
                {/* Avatar */}
                <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
                  <div
                    className="flex h-full w-full items-center justify-center rounded-full text-white text-[10px] font-bold"
                    style={{ backgroundColor: conv.avatarBg }}
                  >
                    {conv.initials}
                  </div>
                  <span
                    className="absolute block rounded-full border-2 border-white"
                    style={{ width: 11, height: 11, bottom: -2, right: -2, backgroundColor: conv.status === "pending" ? "#D1D5DB" : "#10B981" }}
                  />
                </div>

                {/* Info（名字 ≤ 左侧栏 50%，预览 ≤ 60%；宽度由内容决定，时间/状态跟随左移） */}
                <div className="min-w-0">
                  <p title={conv.name} className="text-member text-[#303030] truncate max-w-[140px]">{conv.name}</p>
                  <p title={conv.preview} className="text-body-sm text-muted-foreground truncate mt-0.5 max-w-[168px]">
                    {conv.preview}
                  </p>
                </div>

                {/* Right: time + status */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <span className="text-[11px] text-muted-foreground leading-none">
                    {conv.time}
                  </span>
                  <MiniStatus status={conv.status} />
                </div>
              </div>
            ))}
          </div>

          {/* Bottom spacer */}
          <div className="h-4 shrink-0" />
        </div>
        </div>
        {/* 自定义滚动条（滚动容器外，固定） */}
        <CustomScrollbar scrollRef={teamBodyRef} className="absolute right-1 top-2 bottom-[22px]" />
      </div>
    </aside>
  );
}
