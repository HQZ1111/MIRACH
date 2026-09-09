/**
 * dsh-kernel/sidebar-shell — mirach 侧栏外壳（官方 sidebar 槽接管者）
 *
 * 官方 ui-sidebar 包已从 KERNEL_PLUGINS 移除，本模块用相同的 register 契约
 * 接管 'sidebar' 槽：
 *  - children：完整复制官方 5 个子槽声明（brand.mark / brand.name /
 *    workspaces / settings / footer.action）。官方 ui-workspace /
 *    ui-settings-general / ui-brand-official 的 slots.inject 跟随本声明
 *    自动注册（声明生命周期语义）。子槽只允许一次声明，官方包保留会与
 *    本注册冲突。
 *  - inject：官方同款动作（startSession = uiWorkspace.startSession、
 *    toggleSidebar = layout.toggleSidebar），组件收到的 props 即官方
 *    SidebarRootComponentProps。
 *  组件消费官方 standard hooks（useSessions/useWorkspaces/…，PropsRuntime
 *  的 GlobalStandardProps 合并），自研组合"搜索框 / 当前工作区切换器 /
 *  官方单列表会话（官方 SessionNodeItem 行 + deriveFlat 数据）"。
 *
 *  布局（自上而下）：Header（标题点击切换团队/会话视图 + 折叠按钮）
 *  → 团队视图（头像/统计/全部已读未读/成员列表）或会话视图（新建任务 →
 *  搜索 → 已置顶会话 → 工作区切换器 → [所有会话|成员] → 官方单列表会话
 *  /成员列表 → 已归档）。
 *
 * 兼容性：官方契约（子槽 key、standard hooks、inject 动作）变化由 tsc 经
 * 源码类型导入即时暴露；ui-workspace 的 Rows/tree 走其 ./src/* 开放导出面
 * （与 SidebarRootComponentProps 同接法）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  Archive,
  Check,
  ChevronDown,
  Circle,
  Clock,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  FileCode,
  FileText,
  Fingerprint,
  FolderOpen,
  Loader2,
  MessageCircle,
  Package,
  PanelLeftClose,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search as SearchIcon,
  Trash2,
  UserRound,
  Waypoints,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import type { Context } from "@deepseek-ai/cordis";
// 类型性导入：拉入 GlobalStandardProps / SlotMap / Context 的 locale merge
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
// 官方源码导出路径（./src/* 开放）：类型/组件/词典与 ModelSelect 同接法
import type { SidebarRootComponentProps } from "@deepseek-ai/dsh-client-ui-sidebar/src/client/contract/slots.ts";
import type { SessionSearchResultItem } from "@deepseek-ai/dsh-api-session-controller/client";
import { SessionNodeItem, SearchResultItem } from "@deepseek-ai/dsh-client-ui-workspace/src/client/rows/Rows.tsx";
import { deriveFlat, deriveSearchResults } from "@deepseek-ai/dsh-client-ui-workspace/src/client/tree.ts";
import { zh as workspaceZh } from "@deepseek-ai/dsh-client-ui-workspace/src/client/locales.ts";
import { zh as sidebarZh } from "@deepseek-ai/dsh-client-ui-sidebar/src/client/locales.ts";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { HeaderRule } from "@/components/layout/HeaderRule";
import {
  $sessions,
  createSession,
  renameSession,
  togglePin,
  archiveSession as archiveMirachSession,
  restoreSession,
  deleteSession,
  exportSession,
  upsertEngineSession,
  markSessionContent,
  hasSessionContent,
  type SessionItem,
} from "@/store/sessions";
import { setActiveSession } from "@/store/session";
import { envIdForView, $environments } from "@/store/environments";
import { $agents, $agentsVersion, teamRosterFor, primaryAgentOf } from "@/store/agents";
import { BotFace, defaultShapeFor } from "@/components/layout/AgentAvatar";
import { currentView } from "@/store/current-view";
import { setSidebarCollapsed } from "@/store/layout-mirror";
import { toggleMemberPanel } from "@/store/member-panel";
import { openSessionWindow } from "@/lib/sessionWindow";
import { importEngineSessionEnv, $sessionEnvIndex, sessionBelongsToEnv } from "@/lib/session-env";
import { useAppConfig } from "@/hooks/useAppConfig";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { openPrompt } from "@/store/prompt-dialog";
import { pushToast } from "@/store/toast";
import { requestTrajectory } from "@/store/chat-history";
import { invoke } from "@tauri-apps/api/core";
import { logWarn } from "./kernel-log";

// ─────────────────────────────────────────────────────────────────────────
// 词典翻译（官方 'workspace'/'sidebar' NS 的 zh 表；行组件需要 workspace 座）
// ─────────────────────────────────────────────────────────────────────────

type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

function fillTemplate(tpl: string, params?: Record<string, unknown>): string {
  if (params === undefined) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    return v === undefined ? `{${k}}` : String(v);
  });
}

function dictT(dict: Record<string, string>): TranslateFn {
  return (key, params) => {
    const tpl = dict[key];
    return tpl === undefined ? key : fillTemplate(tpl, params);
  };
}

/** 'workspace' NS 词典座（官方 SessionNodeItem/SearchResultItem 行组件用） */
const workspaceT = dictT(workspaceZh as Record<string, string>);
/** 'sidebar' NS 词典座（折叠/展开按钮提示用） */
const sidebarT = dictT(sidebarZh as Record<string, string>);

// ---- 团队视图配置（与 LeftSidebar 同源：标题/团队名/描述/头像） ----

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

/** 团队视图成员状态图标（与 LeftSidebar 同款样式） */
function MiniStatus({ status }: { status: "generating" | "completed" | "pending" }) {
  if (status === "generating") return <Loader2 className="h-3.5 w-3.5 text-[#F59E0B] animate-spin" strokeWidth={2.5} />;
  if (status === "completed") return <Check className="h-3.5 w-3.5 text-[#10B981]" strokeWidth={2.5} />;
  return <Circle className="h-3.5 w-3.5 text-[#9CA3AF]" strokeWidth={2.5} />;
}

// ─────────────────────────────────────────────────────────────────────────
// 目录浏览类型（官方 browse 型目录选择器的同构本地面；结构随官方
// dsh-host-directory-picker 契约保持稳定，该包非 mirach 直接依赖）
// ─────────────────────────────────────────────────────────────────────────

/** 目录浏览的一行：子目录或面包屑祖先。 */
interface DirectoryEntryLike {
  /** 显示名（面包屑根条目携带完整路径）。 */
  name: string;
  /** 绝对宿主路径 —— 客户端不做路径拼接。 */
  path: string;
  /** 按宿主平台约定隐藏。 */
  hidden: boolean;
}

/** 一层目录及其祖先链（browse 后端的返回形状）。 */
interface DirectoryListingLike {
  /** 所列目录的绝对路径。 */
  path: string;
  /** 宿主账户的家目录（面包屑 "Home" 锚点）。 */
  home: string;
  /** 从文件系统根到所列目录（含）的祖先链，每个 crumb 都是跳转目标。 */
  crumbs: DirectoryEntryLike[];
  /** 直接子目录，按名排序（含指向目录的符号链接）。 */
  entries: DirectoryEntryLike[];
  /** 后端在完整结果边界截断时置 true（更多子目录未列出）。 */
  truncated: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// 内核动作（官方服务的窄通道；registerSidebarShell 时初始化）
// ─────────────────────────────────────────────────────────────────────────

/** 内核 sessions 服务的最小切片（官方 ISessions 的超集子面） */
interface SolidSessions {
  open(id: string): void;
  binding(id: string): { session?: { rename?(title: string): Promise<unknown> } } | undefined;
  fork?(opts: { sessionId: string; increaseTitle?: boolean }): Promise<string>;
  search?(query: string, signal: AbortSignal): Promise<{
    ok: boolean; value?: { items: SessionSearchResultItem[]; hasMore: boolean }; error?: { message?: string };
  }>;
  searchResultLimit?: number;
  refresh?(): Promise<void>;
}

interface SolidUiWorkspace {
  startSession?(workspaceId?: string): void;
  archiveSession?(sessionId: string): Promise<void>;
  pickDirectory?(): Promise<string | null>;
  listDirectory?(path?: string, signal?: AbortSignal): Promise<DirectoryListingLike>;
}

interface SolidWorkspaces {
  create?(input: { path: string }): Promise<unknown>;
}

interface SidebarActions {
  /** 打开官方会话（sessions.open；mirach 活跃会话经反向同步对齐） */
  open(id: string): void;
  /** 重命名会话（行菜单）；主机拒绝时抛错 */
  rename(id: string, title: string): Promise<void>;
  /** 分叉会话并打开子会话（官方同款：increaseTitle） */
  fork(id: string): void;
  /** 归档会话（registry-global 归档集） */
  archive(id: string): Promise<void>;
  /** 远程内容搜索；不可用返回 null（调用方回退本地名称匹配） */
  search(query: string, signal: AbortSignal): Promise<{ items: SessionSearchResultItem[]; hasMore: boolean } | null>;
  searchResultLimit: number;
  /** 目录浏览一层（官方 browse 能力：list）；不可用返回 null */
  listDirectory(path?: string): Promise<DirectoryListingLike | null>;
  /** 把选中目录采纳为工作区（workspaces.create） */
  createWorkspace(path: string): Promise<void>;
}

let sideActions: SidebarActions | null = null;

/** 工作区快照通道（顶栏项目名真实化用）：registerSidebarShell 时缓存
 *  workspaces.list 快照订阅器；MainPanel 轮询/事件时取当前 items。
 *  数据源与官方 WorkspaceBrowser 同一 store（useWorkspaces 的底层）。 */
interface WorkspaceSnapshotLike {
  items: readonly { workspaceId: string; title: string; sessionIds: readonly string[] }[];
}
/** 官方 workspaces.list 快照源（getSnapshot/subscribe）；订阅供顶栏响应式读取。 */
interface WorkspaceSourceLike {
  getSnapshot: () => WorkspaceSnapshotLike | null;
  subscribe: (fn: () => void) => () => void;
}
let workspaceSnapshotGetter: (() => WorkspaceSnapshotLike | null) | null = null;
let workspaceSourceRef: WorkspaceSourceLike | null = null;

/** 取当前工作区快照（items；内核未就绪返回 null）。顶栏项目名真实化消费。 */
export function currentWorkspaceSnapshot(): WorkspaceSnapshotLike | null {
  return workspaceSnapshotGetter?.() ?? null;
}

/** 官方工作区快照源（可订阅）：顶栏工作区名随切换会话/工作区实时更新。 */
export function currentWorkspaceSource(): WorkspaceSourceLike | null {
  return workspaceSourceRef;
}

function initSidebarActions(ctx: Context): SidebarActions {
  const ctxAny = ctx as unknown as {
    sessions?: SolidSessions;
    uiWorkspace?: SolidUiWorkspace;
    workspaces?: SolidWorkspaces;
    get?: (k: string) => unknown;
  };
  const sessions = ctxAny.sessions
    ?? (typeof ctxAny.get === "function" ? (ctxAny.get("sessions") as SolidSessions | undefined) : undefined);
  const uiWorkspace = ctxAny.uiWorkspace
    ?? (typeof ctxAny.get === "function" ? (ctxAny.get("uiWorkspace") as SolidUiWorkspace | undefined) : undefined);
  const workspaces = ctxAny.workspaces
    ?? (typeof ctxAny.get === "function" ? (ctxAny.get("workspaces") as SolidWorkspaces | undefined) : undefined);
  // 工作区快照读取器：官方 workspace-controller 的 list 是快照源对象
  // （WorkspaceSource：getSnapshot()/subscribe()，不是方法）
  const wsSource = (workspaces as unknown as { list?: { getSnapshot?: () => WorkspaceSnapshotLike; subscribe?: (fn: () => void) => () => void } } | undefined)?.list;
  workspaceSnapshotGetter =
    typeof wsSource?.getSnapshot === "function" ? () => wsSource.getSnapshot!() ?? null : null;
  workspaceSourceRef =
    typeof wsSource?.getSnapshot === "function" && typeof wsSource?.subscribe === "function"
      ? { getSnapshot: () => wsSource.getSnapshot!() ?? null, subscribe: (fn) => wsSource.subscribe!(fn) }
      : null;
  return {
    open: (id) => { sessions?.open?.(id); },
    rename: async (id, title) => {
      const session = sessions?.binding?.(id)?.session;
      if (session === undefined || typeof session.rename !== "function") throw new Error(`未知会话 ${id}`);
      const result = await session.rename(title);
      if (typeof result === "object" && result !== null && "ok" in result && (result as { ok?: boolean }).ok === false) {
        throw new Error((result as { error?: { message?: string } }).error?.message ?? "重命名被主机拒绝");
      }
    },
    fork: (id) => {
      void sessions?.fork?.({ sessionId: id, increaseTitle: true })
        .then((childId) => { sessions?.open?.(childId) })
        .catch(() => { /* fork 失败保持当前选择（官方同款） */ });
    },
    archive: async (id) => { await uiWorkspace?.archiveSession?.(id); },
    search: async (query, signal) => {
      if (typeof sessions?.search !== "function") return null;
      const result = await sessions.search(query, signal);
      if (result?.ok !== true) return null;
      return { items: result.value?.items ?? [], hasMore: result.value?.hasMore ?? false };
    },
    searchResultLimit: sessions?.searchResultLimit ?? 20,
    // 本装配的目录选择器为 browse 型（in-app 目录浏览，无 native pick 能力），
    // 与官方 WorkspacePickFlow 同源：弹窗内 list 逐层浏览，选中后 create。
    listDirectory: async (path) => {
      if (typeof uiWorkspace?.listDirectory !== "function") return null;
      try {
        return await uiWorkspace.listDirectory(path);
      } catch {
        return null;
      }
    },
    createWorkspace: async (path) => {
      if (typeof workspaces?.create !== "function") throw new Error("workspaces 服务不可用");
      const result = await workspaces.create({ path });
      if (typeof result === "object" && result !== null && "ok" in result && (result as { ok?: boolean }).ok === false) {
        throw new Error((result as { error?: { message?: string } }).error?.message ?? "创建工作区失败");
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 添加工作区弹窗（官方 browse 型目录选择器：list 逐层浏览 + 选中路径）
// ─────────────────────────────────────────────────────────────────────────

function AddWorkspaceDialog({ open, onClose, onPick, actions }: {
  open: boolean;
  onClose: () => void;
  onPick: (path: string) => void;
  actions: SidebarActions | null;
}) {
  const [listing, setListing] = useState<DirectoryListingLike | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = useCallback(async (path?: string) => {
    setBusy(true);
    setError(null);
    try {
      const list = (await actions?.listDirectory(path)) ?? null;
      if (list === null) {
        setError("目录浏览服务不可用");
      } else {
        setListing(list);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [actions]);

  useEffect(() => {
    if (open) void browse(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="panel-glass relative z-10 flex h-[440px] w-[460px] flex-col rounded-2xl shadow-2xl">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="text-subheading font-bold text-[#303030]">添加工作区</p>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* 面包屑（Home → 各级目录，点击跳级） */}
        <div className="flex min-w-0 items-center gap-1 px-5 pb-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            onClick={() => void browse(undefined)}
            className="shrink-0 text-[12px] font-medium text-[#303030] hover:opacity-80 transition-opacity"
            title={listing?.home}
          >
            Home
          </button>
          {(listing?.crumbs ?? []).map((crumb) => (
            <span key={crumb.path} className="flex min-w-0 items-center gap-1">
              <span className="text-[11px] text-muted-foreground">/</span>
              <button
                onClick={() => void browse(crumb.path)}
                className="shrink-0 max-w-[160px] truncate text-[12px] text-[#303030] hover:opacity-80 transition-opacity"
                title={crumb.path}
              >
                {crumb.name}
              </button>
            </span>
          ))}
        </div>
        {/* 当前目录路径 */}
        <p className="truncate px-5 pb-2 text-[11px] text-muted-foreground" title={listing?.path}>
          {listing?.path ?? "…"}
        </p>
        {/* 目录列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {error !== null && (
            <p className="px-2 py-2 text-[12px] text-[#EF4444]">{error}</p>
          )}
          {busy && <p className="px-2 py-2 text-[12px] text-muted-foreground">正在读取目录…</p>}
          {!busy && error === null && (listing?.entries ?? []).length === 0 && (
            <p className="px-2 py-2 text-[12px] text-muted-foreground/60">（空目录）</p>
          )}
          {(listing?.entries ?? []).map((entry) => (
            <button
              key={entry.path}
              onClick={() => void browse(entry.path)}
              className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-muted transition-colors"
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-[#8B8C8F]" strokeWidth={2} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#303030]">{entry.name}</span>
            </button>
          ))}
        </div>
        {/* 底部动作 */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-1.5 text-[13px] text-[#464646] hover:bg-muted transition-colors"
          >
            取消
          </button>
          <button
            disabled={listing === null || busy}
            onClick={() => { if (listing !== null) onPick(listing.path); }}
            className="rounded-lg bg-[#303030] px-4 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-85 disabled:opacity-40"
          >
            选择此目录
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 共享会话交互（mirach 会话域：置顶/归档条目，引擎磁盘映射与原版一致）
// ─────────────────────────────────────────────────────────────────────────

/** 引擎磁盘会话拉取 + 会话点击/菜单交互（从 LeftSidebar 迁移，行为不变） */
function useMirachSessionInteractions(view: string) {
  const isReal = !MOCK && getApi().mode === "real";
  const engineDshRef = useRef(new Map<string, string>());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuTitle, setMenuTitle] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);
  const [menuH, setMenuH] = useState(320);
  const [panelRect, setPanelRect] = useState<{ l: number; t: number; r: number; b: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { config } = useAppConfig();

  // 挂载/切视图时拉取引擎持久化会话：只并入【当前环境】有映射的条目
  useEffect(() => {
    if (!isReal) return;
    const curEnv = envIdForView(view);
    void invoke<{ sessions?: { id: string; createdAt?: number; title?: string; frontendId?: string; envId?: string }[] }>(
      "dsh_list_sessions",
    )
      .then((r) => {
        const rows = r?.sessions ?? [];
        // 全量并入归属索引（引擎 envId 是权威；其他环境的行也入索引，
        // 供官方单列表按环境过滤），再只把当前环境的条目并进本地会话表
        importEngineSessionEnv(rows.map((s) => ({ frontendId: s.frontendId, envId: s.envId })));
        for (const s of rows) {
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
  }, [isReal, view]);

  const handleSessionClick = (e: React.MouseEvent, s: SessionItem) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.shiftKey) {
      e.preventDefault();
      openSessionWindow(s.id);
      return;
    }
    const dsh = engineDshRef.current.get(s.id);
    if (dsh) {
      void invoke("load_dsh_session", { sessionId: s.id, dshSessionId: dsh }).catch(() => {});
    }
    setActiveSession(s.id);
  };

  const openSessionMenu = (e: React.MouseEvent, s: SessionItem | null, title?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuFor((m) => (s && m === s.id ? null : s?.id ?? null));
    setMenuTitle(title ?? null);
    setMenuPos({ x: e.clientX, y: e.clientY });
    const pr = document.querySelector("[data-panel]")?.getBoundingClientRect();
    setPanelRect(pr ? { l: pr.left, t: pr.top, r: pr.right, b: pr.bottom } : null);
  };

  useLayoutEffect(() => {
    if (!menuPos) return;
    const el = menuRef.current;
    if (el) setMenuH(el.offsetHeight);
  }, [menuPos]);

  return {
    isReal,
    engineDshRef,
    handleSessionClick,
    openSessionMenu,
    menuFor,
    menuTitle,
    menuPos,
    menuH,
    panelRect,
    menuRef,
    setMenuPos,
    setMenuFor,
    config,
  };
}

function fmtSessionTime(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 菜单条目类型（共享会话操作菜单；分隔线用 null） */
interface MenuItem {
  label: string;
  icon: typeof Pin;
  run: () => void;
  danger?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────
// 组件
// ─────────────────────────────────────────────────────────────────────────

/** 兜底外壳：standard hooks 缺失（装配异常）时渲染官方浏览器整块 */
function FallbackSidebar(props: SidebarRootComponentProps) {
  const { collapsed, width, toggleSidebar, renderSlot } = props;
  // 折叠态与主组件一致：侧栏本体隐藏（顶栏图标组接管），不渲染官方 rail
  if (collapsed) return null;
  return (
    <div
      className="flex h-full flex-col bg-white pb-[20px]"
      style={{ width, minWidth: width }}
    >
      <div className="flex shrink-0 items-center justify-between px-4 pt-5 pb-3">
        <span className="text-heading font-bold text-[#303030] leading-[1.4]">Mirach</span>
        <button
          onClick={() => toggleSidebar()}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
        >
          <PanelLeftClose className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {renderSlot("sidebar.workspaces", {
          wide: true,
          expandSidebar: () => {},
        })}
      </div>
      <div className="shrink-0 border-t border-border">
        {renderSlot("sidebar.footer.action", { wide: true })}
        {renderSlot("sidebar.settings", { wide: true })}
      </div>
    </div>
  );
}

/**
 * 官方 footer/设置槽的 body 级 portal 挂载（展开态/折叠态都用）。可视布局
 * 不放设置入口（左侧工具栏齿轮是唯一设置入口），但 settings-surface 需要
 * `[data-slot="settings.trigger"]` 触发按钮存在。挂到 document.body 的
 * 屏幕外容器（fixed left:-10000，0×0）里：触发行在窗口外不可见，而官方
 * 面板（fixed inset:0）相对视口定位、不受容器位置/尺寸影响——弹窗 DOM
 * 彻底脱离应用树的裁剪链（面板 translateZ(0) 包含块、侧栏 overflow、
 * 滚动容器 maskImage 都管不到它），可全窗口拖动、永远在最上层。
 * createPortal 是 React 官方机制：事件仍沿 React 树冒泡，官方 onClick/
 * 状态全部正常；portal 容器常驻，不随开关增删。
 * **只在可见树挂载**（内联 marker 检测 .dsh-native-area 祖先）：镜像树的
 * SettingsRoot 在引擎异常时会随镜像降级消失，双 portal 会让 settings-surface
 * 的类名/拖拽接线落到错误实例上。
 */
function PortalSettingsMount({
  renderSlot,
}: {
  renderSlot: SidebarRootComponentProps["renderSlot"];
}) {
  const markerRef = useRef<HTMLSpanElement | null>(null);
  const [inVisibleTree, setInVisibleTree] = useState(false);
  useLayoutEffect(() => {
    const area = document.querySelector(".dsh-native-area");
    setInVisibleTree(area !== null && markerRef.current !== null && area.contains(markerRef.current));
  }, []);
  if (!inVisibleTree) return <span ref={markerRef} style={{ display: "none" }} />;
  return (
    <>
      <span ref={markerRef} style={{ display: "none" }} />
      {createPortal(
        <div
          data-mirach-settings-portal
          style={{ position: "fixed", left: -10000, top: 0, width: 0, height: 0 }}
        >
          {renderSlot("sidebar.footer.action", { wide: true })}
          {renderSlot("sidebar.settings", { wide: true })}
        </div>,
        document.body,
      )}
    </>
  );
}

/**
 * mirach 侧栏：官方 sidebar 槽的部件。
 * 布局（自上而下）：Header（标题点击切换团队/会话视图 + 折叠按钮）
 * → 团队视图（头像/统计/全部已读未读/成员列表）或会话视图（新建任务 →
 * 搜索 → 已置顶会话 → 工作区切换器 → [所有会话|成员] → 官方单列表会话
 * /成员列表 → 已归档）。
 * standard hooks（useSessions/useWorkspaces/…）来自渲染器注入的 global
 * standard kit —— 仅当 GuardedMirachSidebar 确认齐全后才渲染本组件。
 */
function MirachSidebar(props: SidebarRootComponentProps) {
  const { collapsed, startSession, toggleSidebar, renderSlot } = props;
  // 官方折叠状态直接写全局 store（工具栏背景/顶栏展开按钮都由它驱动）：
  // 官方 AppFrame 的 collapsed prop 是唯一权威信号（含窄视口自动折叠、
  // 拖动右侧栏压窄主区等一切路径），不再依赖宽度观察器的时序。
  useEffect(() => {
    setSidebarCollapsed(collapsed);
  }, [collapsed]);
  const view = useStore(currentView);
  const actions = sideActions;

  // ---- 官方数据 hooks（global standard props，装配完好时恒有） ----
  const { useSessions, useWorkspaces, useSessionPendingInteraction } = props;
  const list = useSessions((s) => s);
  const pendingInteractions = useSessionPendingInteraction((s) => s);
  const workspaces = useWorkspaces((s) => s.items);
  const archivedSessionIds = useWorkspaces((s) => s.archivedSessionIds);

  // ---- mirach 本地状态 ----
  // 标题点击在「团队概览」与「会话列表」之间切换（与 LeftSidebar 行为一致）
  const [viewMode, setViewMode] = useState<"team" | "sessions">("team");
  const [sessionTab, setSessionTab] = useState<"conv" | "member">("conv");
  const [activeTab, setActiveTab] = useState<"all" | "read" | "unread">("all");
  const [query, setQuery] = useState("");
  const [addWsOpen, setAddWsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 行相对时间基准（每次渲染取一次，与官方 FlatList 同款）
  const nowMs = Date.now();

  const cfg = getConfig(view);
  const sessions = useStore($sessions);
  const pinnedSessions = useMemo(() => sessions.filter((s) => s.pinned && !s.archived), [sessions]);
  const archivedSessions = useMemo(() => sessions.filter((s) => s.archived), [sessions]);
  const allAgents = useStore($agents);
  // 主环境聚合全部环境的主人格行（与 LeftSidebar 同源 teamRosterFor）；
  // 订阅 $environments/$agentsVersion——任意环境成员写入都刷新聚合行
  // （跨环境行读其他环境分片，不经过 $agents）。
  useStore($environments);
  useStore($agentsVersion);
  const conversations = (envIdForView(view) === "main" ? teamRosterFor("main") : allAgents).filter(
    (c) => activeTab === "all" || c.tab === activeTab,
  );

  // ---- 官方 flat 单列表（最新优先，无分组）；按环境落归属 ----
  // 引擎 envId 映射（session-env）是权威归属：官方内核会话列表是全局的，
  // 这里把它落到"当前环境的会话"——环境生效即隔离，非客户端自造分组。
  const sessionEnvIndex = useStore($sessionEnvIndex);
  const currentEnvId = envIdForView(view);
  const flatRows = useMemo(
    () =>
      deriveFlat(list, archivedSessionIds, pendingInteractions).filter((node) =>
        sessionBelongsToEnv(node.id, currentEnvId, list.current),
      ),
    [list, archivedSessionIds, pendingInteractions, currentEnvId, sessionEnvIndex],
  );

  // ---- 搜索：本地名称/工作区匹配 + 远程内容搜索（防抖 250ms，失败回退本地） ----
  const normalizedQuery = query.trim();
  const [remoteSearch, setRemoteSearch] = useState<{ items: SessionSearchResultItem[]; hasMore: boolean } | null>(null);
  useEffect(() => {
    if (normalizedQuery === "") {
      setRemoteSearch(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void actions?.search(normalizedQuery, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setRemoteSearch(result);
        })
        .catch(() => { if (!controller.signal.aborted) setRemoteSearch(null); });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, actions]);

  const searchRows = normalizedQuery === ""
    ? null
    : deriveSearchResults(
      list,
      workspaces,
      normalizedQuery,
      archivedSessionIds,
      pendingInteractions,
      { items: remoteSearch?.items ?? [], hasMore: remoteSearch?.hasMore ?? false },
      actions?.searchResultLimit ?? 20,
    );
  // 搜索结果同样按环境落归属（含当前会话例外），不跨环境串列表
  const envSearchRows = searchRows === null
    ? null
    : { ...searchRows, items: searchRows.items.filter((r) => sessionBelongsToEnv(r.id, currentEnvId, list.current)) };

  // 添加工作区（AddWorkspaceDialog 仍由本组件承载；官方浏览器未接管本装配的添加流）
  const pickWorkspacePath = async (path: string) => {
    setAddWsOpen(false);
    try {
      await actions?.createWorkspace(path);
      pushToast("工作区已添加", "success");
    } catch (e) {
      pushToast(`添加工作区失败：${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  // ---- 行动作（官方单列表行菜单：重命名/分叉/归档） ----
  const handleRowRename = async (id: string, currentTitle: string) => {
    const title = (await openPrompt({ title: "重命名会话", initialValue: currentTitle, confirmText: "重命名" }))?.trim();
    if (!title) return;
    try {
      await actions?.rename(id, title);
    } catch (e) {
      pushToast(`重命名失败：${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };

  // 顶栏"搜索"图标（折叠态）触发：先展开侧栏，再聚焦本侧栏的搜索输入框
  useEffect(() => {
    const focusSearch = () => {
      searchInputRef.current?.focus({ preventScroll: true });
    };
    window.addEventListener("mirach:focus-sidebar-search", focusSearch);
    return () => window.removeEventListener("mirach:focus-sidebar-search", focusSearch);
  }, []);

  // ---- 共享会话交互（置顶/归档与右键菜单，行为与 LeftSidebar 原版一致） ----
  const sxi = useMirachSessionInteractions(view);
  const menuSession = sxi.menuFor
    ? sessions.find((s) => s.id === sxi.menuFor) ?? null
    : sxi.menuTitle
      ? sessions.find((s) => s.title === sxi.menuTitle) ??
        ({ id: "", title: sxi.menuTitle, preview: "", time: "", pinned: false, archived: false } as SessionItem)
      : null;
  const ensureMenuSession = (): SessionItem | null => {
    if (menuSession && menuSession.id) return menuSession;
    if (!sxi.menuTitle) return null;
    // 工作区右键菜单动作需要"一个会话"时，新建标准会话（标题"新会话"，
    // 引擎按首条消息自动命名）——不要用工作区名当会话标题（会被误认成
    // 工作区条目出现在会话列表里）。
    return createSession("新会话");
  };

  // 折叠态写全局 store 的同步在上面；展开态渲染入口动作
  // ---- 快捷入口：产物 / 看板 / 定时任务（覆盖层经 AppLayout 事件打开，与旧 LeftSidebar 同款） ----
  const openOverlay = (view: "artifacts" | "kanban" | "cron") => {
    window.dispatchEvent(new CustomEvent("mirach:open-overlay", { detail: view }));
  };

  // ================= 折叠态：侧栏本体隐藏（不渲染 rail 工具栏） =================
  // "展开/新建任务/搜索"图标由主对话区顶栏（MainPanel 折叠态图标组）接管，
  // 位于项目名左边；可视内容为空，但官方设置槽保持 body portal 挂载——
  // 折叠态下左侧工具栏齿轮仍能经 settings-surface 打开官方设置。
  if (collapsed) {
    return (
      <div className="h-full w-full">
        <PortalSettingsMount renderSlot={renderSlot} />
      </div>
    );
  }

  // ================= 展开态（280px；顶部排版参考原 LeftSidebar header） =================
  // 布局参考 my-hermes-rs：侧栏为独立全高列（官方 AppFrame 列全高渲染，
  // 对话列底部 20px 留白由 index.css 的 centerCol padding 提供）。
  return (
    <div
      // pb-[20px]：侧栏底部 20px 空白限制区（与主对话区底部留白对齐，
      // 内容列表在 20px 之上结束）
      // 宽度交给 CSS（index.css: [data-slot="sidebar"] > div { width:100% }），
      // 与列宽同帧同步（拖动/钳制任何时刻内容都随列、不溢出、不晃动）
      className="flex h-full flex-col bg-white pb-[20px]"
    >
      {/* Header（85px：标题点击切换团队/会话视图 + 折叠按钮 + 底部分割线） */}
      <div className="relative flex shrink-0 items-center justify-between px-4" style={{ height: 85 }}>
        <HeaderRule />
        <div className="flex flex-col gap-1 min-w-0">
          <button
            onClick={() => setViewMode(viewMode === "team" ? "sessions" : "team")}
            className="text-heading font-bold text-[#303030] leading-[1.4] text-left hover:opacity-80 transition-opacity"
          >
            {cfg.label}
          </button>
          <span className="text-body-sm text-muted-foreground leading-none">
            {viewMode === "team" ? "团队列表" : "会话列表"}
          </span>
        </div>
        <button
          onClick={() => toggleSidebar()}
          title={sidebarT("toggle.collapse")}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
        >
          <PanelLeftClose className="h-6 w-6" strokeWidth={2} />
        </button>
      </div>

      {/* 主体（滚动）：mask 加在滚动容器上——底部 40px 渐隐带固定在列表
          底部（内容滚动时最后一条从底部淡出），顶部没有渐隐。
          滚动条走 mirach 令牌样式（index.css：2px 细线，悬停显示）。 */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto pb-3"
        style={{ maskImage: "linear-gradient(to bottom, black calc(100% - 40px), transparent 100%)" }}
      >
        {/* 内容区（团队头像起）整体下移 15px（顶部 header 不动） */}
        <div className="flex flex-col items-stretch px-3 pt-[15px]">
          {/* ======== 团队概览视图（点击标题切换；原 LeftSidebar team 视图） ======== */}
          {viewMode === "team" && (
            <div className="flex flex-col items-stretch">
              {/* 团队头像 = 当前环境主人格头像（BotFace 同款，只放大到 84px）；
                  无主人格数据时回退环境配置字母圆。 */}
              <div className="relative mb-4 self-center" style={{ width: 84, height: 84 }}>
                {(() => {
                  const primary = primaryAgentOf(currentEnvId);
                  return primary ? (
                    <BotFace
                      color={primary.avatarBg}
                      image={primary.avatarImage}
                      name={primary.name}
                      shape={primary.avatarShape || defaultShapeFor(primary.name)}
                      size={84}
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center rounded-full text-white font-bold text-2xl"
                      style={{ backgroundColor: cfg.avatarBg }}
                    >
                      {cfg.initials}
                    </div>
                  );
                })()}
                <span
                  className="absolute block rounded-full border-[3px] border-white"
                  style={{ width: 18, height: 18, bottom: -5, right: -5, backgroundColor: "#10B981" }}
                />
              </div>
              <p className="text-subheading text-[#303030] text-center">{cfg.team}</p>
              <p className="text-body-sm text-muted-foreground text-center mt-1 leading-relaxed">
                {cfg.desc}
              </p>
              <div className="flex items-center justify-center gap-6 mt-4 self-center">
                <div className="flex items-center gap-1.5">
                  <UserRound className="h-4 w-4 text-[#303030]" strokeWidth={2} />
                  <span className="text-lg font-bold text-[#303030] leading-none">{allAgents.length}</span>
                </div>
                <div className="w-px h-10 bg-border" />
                <div className="flex items-center gap-1.5">
                  <MessageCircle className="h-4 w-4 text-[#303030]" strokeWidth={2} />
                  <span className="text-lg font-bold text-[#303030] leading-none">
                    {sessions.filter((s) => !s.archived && hasSessionContent(s.id)).length}
                  </span>
                </div>
              </div>
              <div className="w-full h-px bg-border my-4" />
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
                          active ? "text-[#303030]" : "text-body-sm text-muted-foreground hover:text-[#464646]",
                        )}
                        style={active ? { fontSize: 15, fontWeight: 700 } : undefined}
                      >
                        {labels[tab]}
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className="space-y-0.5">
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    onClick={() => toggleMemberPanel(conv.id)}
                    className="-mx-3 -my-[1px] flex w-[calc(100%+24px)] items-center gap-2.5 rounded-none pl-3 py-2 cursor-pointer transition-colors duration-50 hover:bg-muted"
                  >
                    <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
                      <div
                        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"
                        style={{ backgroundColor: conv.avatarImage ? "transparent" : conv.avatarBg }}
                      >
                        <BotFace color={conv.avatarBg} image={conv.avatarImage} name={conv.name} shape={conv.avatarShape || defaultShapeFor(conv.name)} size={32} />
                      </div>
                      <span
                        className="absolute block rounded-full border-2 border-white"
                        style={{ width: 11, height: 11, bottom: -2, right: -2, backgroundColor: conv.status === "pending" ? "#D1D5DB" : "#10B981" }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p title={conv.name} className="text-member text-[#303030] truncate max-w-[140px]">{conv.name}</p>
                      <p title={conv.preview} className="text-body-sm text-muted-foreground truncate mt-0.5 max-w-[168px]">
                        {conv.preview}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0 pr-3">
                      <span className="text-[11px] text-muted-foreground leading-none">
                        {conv.time}
                      </span>
                      <MiniStatus status={conv.status} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="h-4 shrink-0" />
            </div>
          )}

          {/* ======== 会话列表视图（默认；快捷入口 → 官方浏览区 → 成员） ======== */}
          {viewMode === "sessions" && (
            <>
          {/* 新建任务 + 产物 + 看板 + 定时任务（竖向排列，与旧 LeftSidebar 一致） */}
          <div className="flex flex-col gap-1 pb-2 shrink-0">
            <button
              onClick={() => startSession()}
              className="flex w-full items-center gap-[16px] rounded-lg py-1.5 text-member text-[#303030] hover:bg-muted transition-colors text-left"
            >
              <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">新建任务</span>
              <span className="text-body-sm text-muted-foreground">Ctrl+N</span>
            </button>
            <button
              onClick={() => openOverlay("artifacts")}
              className="flex w-full items-center gap-[16px] rounded-lg py-1.5 text-member text-[#303030] hover:bg-muted transition-colors text-left"
            >
              <Package className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">产物</span>
            </button>
            <button
              onClick={() => openOverlay("kanban")}
              className="flex w-full items-center gap-[16px] rounded-lg py-1.5 text-member text-[#303030] hover:bg-muted transition-colors text-left"
            >
              <Columns3 className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">看板</span>
            </button>
            <button
              onClick={() => openOverlay("cron")}
              className="flex w-full items-center gap-[16px] rounded-lg py-1.5 text-member text-[#303030] hover:bg-muted transition-colors text-left"
            >
              <Clock className="h-4 w-4 shrink-0" strokeWidth={2} />
              <span className="flex-1">定时任务</span>
            </button>
          </div>

          {/* 官方搜索框（本地+远程内容搜索；常驻展开） */}
          <div className="shrink-0 pb-2">
            <div className="flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2 py-1.5">
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2} />
              <input
                ref={searchInputRef}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[#303030] outline-none placeholder:text-muted-foreground/70"
                type="text"
                placeholder={workspaceT("search.placeholder")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  setQuery("");
                }}
              />
              {query !== "" && (
                <button
                  type="button"
                  aria-label={workspaceT("search.clear")}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-[#303030]"
                  onClick={(e) => { e.stopPropagation(); setQuery(""); }}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* 已置顶会话（mirach 自有；圆角与搜索框一致 rounded-lg，不用胶囊型） */}
          <div className="mb-2 shrink-0 rounded-lg border border-border bg-muted/30">
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="w-full py-1.5 pl-2 pr-1.5 group/pinned">
                <span className="flex w-full items-center gap-2">
                  <Pin className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
                  <span className="flex-1 text-left text-member">已置顶会话</span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]/pinned:rotate-180" />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-2 pb-1.5">
                  {pinnedSessions.length === 0 ? (
                    <p className="px-2 py-1 text-body-sm text-muted-foreground/60">暂无置顶会话</p>
                  ) : (
                    pinnedSessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={(e) => sxi.handleSessionClick(e, s)}
                        title="点击打开 · ⇧⌘+点击新窗口"
                        onContextMenu={(e) => sxi.openSessionMenu(e, s)}
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

          {/* 官方工作区切换器（dsh ui-workspace 的 WorkspaceBrowser 整块：
              工作区列表/新增/重命名/删除/排序 + 视图选项，全部官方交互。
              sidebar.workspaces 槽由 ui-workspace 的 apply 注册占据，
              renderSlot 出口即官方整块；不加边框——官方组件自带分区样式，
              与侧栏背景融为一体（对齐官方 SidebarRoot 渲染形态）） */}
          <div className="min-h-0 flex-1" data-mirach-official-browser>
            {renderSlot("sidebar.workspaces", { wide: true, expandSidebar: () => {} })}
          </div>

          {/* Tabs: 所有会话 / 成员 */}
          <div className="flex items-center w-full shrink-0">
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
          <div className="w-full h-px bg-border mb-2 shrink-0" />

          {/* 所有会话 = 官方单列表（flat 视图，行=官方详细会话条）／搜索态=搜索结果 */}
          {sessionTab === "conv" && (
            <div className="space-y-0.5">
              {normalizedQuery !== "" ? (
                envSearchRows === null || envSearchRows.items.length === 0 ? (
                  <p className="px-2 py-2 text-body-sm text-muted-foreground/60">{workspaceT("empty.noMatches")}</p>
                ) : (
                  envSearchRows.items.map((r) => (
                    <SearchResultItem
                      key={r.id}
                      result={r}
                      currentId={list.current}
                      onOpen={(id) => actions?.open(id)}
                      t={workspaceT}
                    />
                  ))
                )
              ) : flatRows.length === 0 ? (
                <p className="px-2 py-2 text-body-sm text-muted-foreground/60">{workspaceT("empty.none")}</p>
              ) : (
                flatRows.map((node) =>
                  <SessionNodeItem
                    key={node.id}
                    node={node}
                    currentId={list.current}
                    now={nowMs}
                    onOpen={(id) => actions?.open(id)}
                    onRename={(id, title) => void handleRowRename(id, title)}
                    onFork={(id) => actions?.fork(id)}
                    onArchive={(id) => { void actions?.archive(id); }}
                    flat
                    t={workspaceT}
                  />
                )
              )}
            </div>
          )}

          {/* 成员列表（点击打开与该成员的对话；添加/编辑/删除在设置 → 智能体） */}
          {sessionTab === "member" && (
            <div>
              {conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => toggleMemberPanel(conv.id)}
                  className="group relative -mx-3 -my-[1px] flex w-[calc(100%+24px)] items-center gap-2.5 rounded-none pl-3 py-2 cursor-pointer transition-colors duration-50 hover:bg-muted"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2.5">
                    <div className="relative shrink-0" style={{ width: 36, height: 36 }}>
                      <div
                        className="flex h-full w-full items-center justify-center overflow-hidden rounded-full"
                        style={{ backgroundColor: conv.avatarImage ? "transparent" : conv.avatarBg }}
                      >
                        <BotFace color={conv.avatarBg} image={conv.avatarImage} name={conv.name} shape={conv.avatarShape || defaultShapeFor(conv.name)} size={32} />
                      </div>
                      <span className="absolute block rounded-full border-2 border-white" style={{ width: 11, height: 11, bottom: -2, right: -2, backgroundColor: conv.status === "pending" ? "#D1D5DB" : "#10B981" }} />
                    </div>
                    <span title={conv.name} className="text-member text-[#303030] flex-1 truncate max-w-[140px]">{conv.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{conv.time}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

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
            </>
          )}
        </div>

        {/* 共享会话操作菜单（右键打开；Portal 到 body，避开 transform 祖先） */}
        {menuSession && sxi.menuPos &&
          createPortal(
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => { sxi.setMenuFor(null); sxi.setMenuPos(null); }}
                onContextMenu={(e) => { e.preventDefault(); sxi.setMenuFor(null); sxi.setMenuPos(null); }}
              />
              <div
                ref={sxi.menuRef}
                className="panel-glass menu-anim fixed z-50 w-44 rounded-xl py-1"
                style={{
                  left: sxi.panelRect
                    ? Math.min(Math.max(sxi.menuPos.x, sxi.panelRect.l + 4), sxi.panelRect.r - 188 - 4)
                    : Math.min(sxi.menuPos.x, window.innerWidth - 188),
                  top: sxi.panelRect
                    ? Math.min(Math.max(sxi.menuPos.y, sxi.panelRect.t + 4), sxi.panelRect.b - sxi.menuH - 4)
                    : Math.min(sxi.menuPos.y, window.innerHeight - 320),
                }}
              >
                {buildSessionMenuItems(menuSession, ensureMenuSession, sxi).map((item, idx) =>
                  item === null ? (
                    <div key={`sep-${idx}`} className="mx-2 my-1 h-px bg-border" />
                  ) : (
                    <button
                      key={item.label}
                      onClick={() => {
                        sxi.setMenuFor(null);
                        sxi.setMenuPos(null);
                        item.run();
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm transition-colors hover:bg-muted",
                        item.danger ? "text-red-500" : "text-[#303030]",
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

      {/* 官方 footer/设置槽 body portal 挂载（可视布局不放设置入口——左侧工具栏
          齿轮是唯一设置入口，经 settings-surface 打开全窗口面板）。portal 容器
          屏幕外 0×0：触发行在窗口外不可见；官方面板 fixed 相对视口、脱离应用
          裁剪链（面板 translateZ(0)/侧栏 overflow/滚动容器 maskImage 都管不到），
          全窗口、最上层、可拖出软件边界。 */}
      <PortalSettingsMount renderSlot={renderSlot} />

      {/* 添加工作区：目录浏览弹窗（官方 browse 型目录选择） */}
      <AddWorkspaceDialog
        open={addWsOpen}
        onClose={() => setAddWsOpen(false)}
        onPick={(path) => void pickWorkspacePath(path)}
        actions={actions}
      />
    </div>
  );
}

/** 共享会话操作菜单项（与 LeftSidebar 原版一致：置顶/新窗口/重命名/归档/导出/路径/轨迹/删除） */
function buildSessionMenuItems(
  menuSession: SessionItem,
  ensureMenuSession: () => SessionItem | null,
  sxi: ReturnType<typeof useMirachSessionInteractions>,
): (MenuItem | null)[] {
  const config = sxi.config;
  return [
    { label: menuSession.pinned ? "取消置顶" : "置顶", icon: Pin, run: () => { const s = ensureMenuSession(); if (s) togglePin(s.id); } },
    { label: "在新窗口打开", icon: ExternalLink, run: () => { const s = ensureMenuSession(); if (s) openSessionWindow(s.id); } },
    { label: "重命名", icon: Pencil, run: async () => {
      const s = ensureMenuSession();
      if (!s) return;
      const t = (await openPrompt({ title: "重命名会话", initialValue: s.title, confirmText: "重命名" }))?.trim();
      if (!t) return;
      if (sxi.isReal) void getApi().renameSession(s.id, t).catch(() => {});
      renameSession(s.id, t);
    } },
    { label: "归档", icon: Archive, run: () => { const s = ensureMenuSession(); if (s && window.confirm(`归档会话「${s.title}」？可从 store 恢复。`)) archiveMirachSession(s.id); } },
    { label: "导出 JSON", icon: Download, run: () => { const s = ensureMenuSession(); if (s) exportSession(s.id); } },
    null,
    { label: "在资源管理器中打开", icon: FolderOpen, run: () => { const p = config.workspace; if (p) void invoke("reveal_path", { path: p }).catch(() => {}); } },
    { label: "复制路径", icon: Copy, run: () => void navigator.clipboard.writeText(config.workspace || "").catch(() => {}) },
    { label: "复制任务路径", icon: FileText, run: () => void navigator.clipboard.writeText(config.workspace || "").catch(() => {}) },
    { label: "复制日志路径", icon: FileCode, run: () => void navigator.clipboard.writeText(config.dataDir || "").catch(() => {}) },
    { label: "复制会话 ID", icon: Fingerprint, run: () => { const s = ensureMenuSession(); if (s) void navigator.clipboard.writeText(s.id).catch(() => {}); } },
    { label: "查看调用轨迹", icon: Waypoints, run: () => { requestTrajectory(); } },
    null,
    { label: "删除", icon: Trash2, danger: true, run: () => {
      const s = ensureMenuSession();
      if (!s) return;
      if (!window.confirm(`彻底删除会话「${s.title}」？不可恢复。`)) return;
      if (sxi.isReal) void getApi().deleteSession(s.id).catch(() => {});
      deleteSession(s.id);
    } },
  ];
}

/** 入口守卫：standard hooks 缺失（装配异常）→ 兜底外壳渲染官方浏览器整块 */
function GuardedMirachSidebar(props: SidebarRootComponentProps) {
  if (props.useSessions === undefined || props.useWorkspaces === undefined || props.useSessionPendingInteraction === undefined) {
    return <FallbackSidebar {...props} />;
  }
  return <MirachSidebar {...props} />;
}

// ─────────────────────────────────────────────────────────────────────────
// 注册：接管官方 sidebar 槽（官方 ui-sidebar 包已移除，无冲突；children 声明
// 完整复制官方，ui-workspace / ui-settings-general / ui-brand-official 的
// slots.inject 跟随本声明自动注册）
// ─────────────────────────────────────────────────────────────────────────

export function registerSidebarShell(ctx: Context): void {
  try {
    const locale = (ctx as unknown as { locale?: { register?: (ns: string, dict: object) => void } }).locale;
    // 'sidebar' 词典（官方 ui-sidebar 包已移除，本注册自供；单语中文，en 用 zh 兜底）
    locale?.register?.("sidebar", { zh: sidebarZh, en: sidebarZh });

    sideActions = initSidebarActions(ctx);

    const slots = ctx.slots as unknown as {
      inject: (key: string, cb: () => void) => void;
      register: (options: Record<string, unknown>, component: unknown) => () => void;
    };
    slots.inject("sidebar", () => {
      slots.register(
        {
          name: "sidebar",
          id: "mirach-sidebar",
          registrant: "mirach",
          locale: "sidebar",
          children: {
            "sidebar.brand.mark": { kind: "single", scope: "root" },
            "sidebar.brand.name": { kind: "single", scope: "root" },
            "sidebar.workspaces": { kind: "single", scope: "root" },
            "sidebar.settings": { kind: "single", scope: "root" },
            "sidebar.footer.action": { kind: "list", scope: "root" },
          },
          inject: () => ({
            startSession: (workspaceId?: string) => {
              const ctxAny = ctx as unknown as { uiWorkspace?: SolidUiWorkspace; get?: (k: string) => unknown };
              const uw = ctxAny.uiWorkspace
                ?? (typeof ctxAny.get === "function" ? (ctxAny.get("uiWorkspace") as SolidUiWorkspace | undefined) : undefined);
              uw?.startSession?.(workspaceId);
            },
            toggleSidebar: () => {
              const ctxAny = ctx as unknown as {
                layout?: { toggleSidebar?: () => void };
                get?: (k: string) => unknown;
              };
              const layout = ctxAny.layout
                ?? (typeof ctxAny.get === "function" ? (ctxAny.get("layout") as { toggleSidebar?: () => void } | undefined) : undefined);
              layout?.toggleSidebar?.();
            },
          }),
        },
        GuardedMirachSidebar,
      );
    });
  } catch (err) {
    logWarn("sidebar shell registration failed: %s", err instanceof Error ? err.message : String(err));
  }
}
