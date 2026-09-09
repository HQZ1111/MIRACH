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

import { useCallback, useMemo, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useStore } from "@nanostores/react";
import { cn } from "@/lib/utils";
// 顶栏描边线已改由官方 header 底部 ::after 承担（index.css）
import { TerminalPanel } from "@/components/chat/TerminalPanel";
import { StatusWindow } from "@/components/chat/status-stack/StatusWindow";
import { UserQuestionCard } from "@/components/chat/UserQuestionCard";
import { $pendingQuestions, setPendingQuestions, dropExpiredQuestions } from "@/store/user-questions";
import { $activeSessionId } from "@/store/session";
import { $sessions, markSessionContent, setSessionsEnv } from "@/store/sessions";
import { pushRawEvents, resetRawEvents } from "@/store/session-events";
import { $projects, $selectedProjectId } from "@/store/projects";
import { loadLiveHistory } from "@/store/chat";
import { MOCK } from "@/lib/mock";
import { getApi } from "@/lib/api";
import { invoke } from "@tauri-apps/api/core";
import { $providerConfig } from "@/store/providerConfig";
import { envById, envIdForView, $envVersion, $environments } from "@/store/environments";
import { $defaultAgent } from "@/store/ui-settings";
import { $agents, setAgentsEnv, DEFAULT_TEAM_ID } from "@/store/agents";
import { NativeChatArea } from "@/components/chat/NativeChatArea";
import { ChatToolButton } from "@/components/chat/ChatToolButton";
import { useQueueAutoDrain } from "@/hooks/useQueueAutoDrain";
import { $engineEnv, $mainPersona } from "@/store/engine-session";
import { useOfficialHeader } from "@/dsh-kernel/official-header";
import { useTodoAutoDismiss } from "@/hooks/useTodoAutoDismiss";
import { useBackgroundAutoDismiss } from "@/hooks/useBackgroundAutoDismiss";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import {
  Boxes,
  Code,
  Cpu,
  Database,
  Ellipsis,
  Mic,
  PanelLeft,
  PanelLeftOpen,
  Puzzle,
  Table2,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CommandPalette, type CommandPaletteAction } from "@/components/command-palette/CommandPalette";
import { MagnifyingGlass, CaretDown } from "@phosphor-icons/react";
import { ViewPage } from "@/pages/ViewPages";
import { sidebarCollapsed } from "@/store/layout-mirror";
import { nativeToggleSidebar } from "@/dsh-kernel/boot";

// ================================================================
// 工作状态类型
// ================================================================
// ActivityStep 已移除 — 思考过程改用 ThinkingDisclosure 组件
// 工具调用改用 ToolEntry 组件 + $toolCalls store

// ================================================================
// 顶栏插件图标条（真实数据源 = 引擎装配清单 config.pluginEntries）
// 旧版读 plugins store 的本地 mock 目录（git/docker/k8s 等假插件）已移除。
// ================================================================

/** 真实引擎插件目录（sidecar config.pluginEntries 装配镜像；官方 UI 插件清单）。
 *  顶栏图标条真实化：旧版读本地 mock 目录（git/docker/k8s 等假插件）。 */
function useEnginePlugins(): { id: string; name: string }[] {
  const [list, setList] = useState<{ id: string; name: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void getApi()
        .listEnginePlugins()
        .then((items) => {
          if (!cancelled) setList(items);
        })
        .catch(() => {});
    };
    load();
    // 引擎装配随插件安装/卸载/重启变化：低频轮询即可（30s）
    const t = window.setInterval(load, 30_000);
    const onReload = () => load();
    window.addEventListener("hermes-config-reload", onReload);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      window.removeEventListener("hermes-config-reload", onReload);
    };
  }, []);
  return list;
}

/** 引擎插件 id → 图标（无匹配的插件用 Puzzle 兜底图标） */
const ENGINE_PLUGIN_ICON: Record<string, LucideIcon> = {
  "dsh-tavern": Boxes,
  "dsh-pocket": Database,
  "dsh-workgroup": Users,
  "dsh-realtime-voice": Mic,
  "dsh-muv-engine": Cpu,
  "dsh-muv-table": Table2,
  "dsh-subagent-codex": Code,
  "dsh-subagent-claude-code": Terminal,
};

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
  onOpenPlugins,
}: {
  width: number;
  showLeft: boolean;
  onExpandLeft: () => void;
  /** 顶部命令搜索控制器（搜索框输入 + 结果下拉） */
  palette?: PaletteController;
  /** 插件图标点击（打开真实插件面板） */
  onOpenPlugins?: () => void;
}) {
  // 标题块固定上限（CSS max-w-[320px]）：项目名与会话名都在其内截断，
  // 插件图标条位置稳定不受会话名长短影响
  // 标题 = 工作区名（官方 workspaces.list 里当前引擎会话所属工作区），
  // 随官方 current 会话实时更新（点侧栏切换会话时同步）；内核未就绪回落 Mirach
  const officialHeader = useOfficialHeader();
  const projectName = officialHeader.workspaceTitle ?? "Mirach";
  // 插件图标条 = 真实引擎插件（config.pluginEntries 装配镜像；官方 UI 插件清单）
  const ENGINE_PLUGINS = useEnginePlugins();
  const pluginCap = Math.max(1, Math.floor((width * 0.25) / PLUGIN_SLOT));
  const visibleCount = Math.min(pluginCap, ENGINE_PLUGINS.length);
  const visiblePlugins = ENGINE_PLUGINS.slice(0, visibleCount);
  const pluginOverflow = ENGINE_PLUGINS.length > visibleCount;
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
      // flex-1：顶栏位于绝对覆盖层（flex 容器）内——拉伸占满剩余宽度。
      // 高度 53："会话名 + 对话/轨迹"行（覆盖层第二行、与官方 tabs 同区）
      // 在顶栏行下方、85 描边线（第二行底部边框）之上。
      // paddingTop 14：内容（项目名等）垂直中心与左侧栏"Mirach"标题对齐
      // （实测项目名中心比 Mirach 标题低 9px；paddingTop 与中心的
      // 移动比约 9:5，32 → 14 上移约 10px 对齐）
      className="relative flex items-center px-5 shrink-0 flex-1"
      style={{ height: 53, paddingTop: 14 }}
    >
      {/* 左侧栏收起时显示展开按钮：位置在主对话区顶栏行（与侧栏标题同行高）、
          高度与侧栏内收起按钮一致（h-7 w-7，非放大版）；项目名左对齐，
          不被此图标挤动（图标占位在标题块之前，标题块保持左锚） */}
      {!showLeft && (
        <button
          onClick={onExpandLeft}
          title="展开侧边栏"
          className="relative z-20 mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#464646] hover:bg-muted transition-colors"
        >
          <PanelLeft className="h-6 w-6" strokeWidth={2} />
        </button>
      )}
      {/* ---- 标题：第一行 = 工作区名 + 插件图标条（真实引擎插件）；
           第二行 = 会话名（独立一行完整显示，不被图标截断）。
           项目名/会话名整体左对齐：标题块左锚 + flex-1 填充右侧 ---- */}
      <div className="flex min-w-0 flex-col gap-1 max-w-[520px]">
        <div className="flex min-w-0 items-center gap-3">
          <h2 title={projectName} className="truncate text-heading font-bold text-[#303030] leading-[1.4]">
            {projectName}
          </h2>
          {/* ---- 真实引擎插件区（config.pluginEntries；点击打开插件面板） ---- */}
          <div ref={pluginsRef} className="flex shrink-0 items-center">
            <div className="flex items-center gap-0.5 overflow-hidden">
              {visiblePlugins.map((p) => {
                const Icon = ENGINE_PLUGIN_ICON[p.id] ?? Puzzle;
                return (
                  <button
                    key={p.id}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                    title={p.name}
                    onClick={() => onOpenPlugins?.()}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </button>
                );
              })}
              {pluginOverflow && (
                <button
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
                  title="更多插件"
                  onClick={() => onOpenPlugins?.()}
                >
                  <Ellipsis className="h-4 w-4" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ---- 插件弹窗（省略号点击；锚定在标题区下方；点击项打开真实插件面板） ---- */}
      {pluginsOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPluginsOpen(false)} />
          <div className="panel-glass menu-anim absolute left-5 top-full z-40 mt-1 w-48 rounded-xl py-1">
            <p className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">引擎插件（官方装配清单）</p>
            {ENGINE_PLUGINS.map((p) => {
              const Icon = ENGINE_PLUGIN_ICON[p.id] ?? Puzzle;
              return (
                <button
                  key={p.id}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                  onClick={() => {
                    setPluginsOpen(false);
                    onOpenPlugins?.();
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={2} />
                  <span className="flex-1">{p.name}</span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ---- 空白区 + 一体式快捷搜索（位于插件右侧空白的正中间；空白不足时隐藏） ---- */}
      {showSearch ? (
        <>
          <div className="flex-1" />
          {/* 占位容器：固定搜索栏宽度，保证标题区 flex 布局不跳动。
              下移 15px（用户要求快捷搜索框与顶栏内容略微错位） */}
          <div className="relative z-50 shrink-0 mt-[15px]" style={{ width: INPUT_WIDTH, height: 32 }}>
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


// ================================================================
// 对话内容区
// ================================================================


// 后台任务触发器（dsh ui-jobs JobListAction 对齐：header 处运行中计数 +
// 弹出任务列表；引擎 /bg list + /bg cancel 驱动，真实模式可用）

// 会话目标栏（dsh GoalBar 对齐：当前会话目标 + 状态点 + 内联编辑）

// 消息源：mock 模式按会话隔离（session-chat store 惰性生成，切换会话内容跟随），
// 真实模式用 $liveMessages（relay:reply 事件驱动）。

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
  /** 打开插件面板（顶栏插件图标/更多点击） */
  onOpenPlugins?: () => void;
}

// ---- 各组件共享的单例 ref：历史重放请求序号（见切环境流水线的 dsh_get_history）----
const historyReqSeq = { current: 0 };

// 各区域可缩小的最小高度
const MIN_CHAT = 150;
const MIN_TERMINAL = 150;
// 终端最大高度 = 总高 - 顶85 - 底20 - 手柄6 - 对话区最小150 - 输入框最小106
const MAX_TERMINAL = 900 - 85 - 20 - 6 - MIN_CHAT - 106;

export function MainPanel({ className, style, showLeft = true, onExpandLeft, palette, activeView = "chat", mainWidth, onOpenPlugins }: MainPanelProps) {
  // 官方侧栏折叠态（layout-mirror）：折叠时顶栏左侧显示"展开/新建/搜索"图标组
  const sidebarCollapsedState = useStore(sidebarCollapsed);
  // ---- 终端页展开/收起（默认收起） ----
  const [terminalOpen, setTerminalOpen] = useState(false);
  // ---- 终端高度（手柄拖拽调整；对话区 flex-1 自动吸收变化）----
  const [terminalH, setTerminalH] = useState(MIN_TERMINAL);
  // Ctrl+O 全局详细/简洁双档（参考 zosma：工具详情/思考一键切换技术视图）。
  // 状态放 MainPanel：切到工具类视图时快捷键仍生效。
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
  // Ctrl+O 全局详细/简洁双档（参考 zosma：工具详情/思考一键切换技术视图）。
  // 主栏实际宽度（容器宽度走 CSS 变量；mainWidth 仅用于 HeaderSection 等内部布局）
  const mainW = mainWidth ?? 380;
  const activeId = useStore($activeSessionId);
  // 顶栏第二行的会话名（"对话/轨迹"标签页左侧同行显示）：官方 displayTitle
  // 优先（随官方 current 会话变化——点侧栏切换会话即更新），回落 mirach 会话名
  const officialHeader = useOfficialHeader();
  const mirachSessionTitle = useStore($sessions).find((s) => s.id === activeId)?.title ?? "新会话";
  const topSessionTitle = officialHeader.sessionTitle ?? mirachSessionTitle;
  // 官方 centerCol 元素：顶栏覆盖层经 portal 挂入其中（与内容同帧绘制，
  // 拖动左栏手柄时顶栏不再因跨层变量同步产生位移/帧差）
  const [centerColEl, setCenterColEl] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () => document.querySelector('.dsh-native-area [class*="_centerCol"]') as HTMLElement | null;
    const el = find();
    if (el !== null) {
      setCenterColEl(el);
      return;
    }
    const mo = new MutationObserver(() => {
      const found = find();
      if (found !== null) {
        setCenterColEl(found);
        mo.disconnect();
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
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
        // 主聊天 persona：默认成员（Mirach chat）或用户设置的默认成员的 systemPrompt
        const members = $agents.get();
        const persona = members.find((a) => a.id === ($defaultAgent.get() || DEFAULT_TEAM_ID))?.systemPrompt;
        // 写入共享引擎绑定源（成员私聊发送前用它恢复主 persona，见 engine-session）
        $engineEnv.set({ id: env.id, cwd: env.cwd || null });
        $mainPersona.set(persona ?? null);
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
  // 官方输入条里的 mirach「终端」控件（dsh-kernel/composer-extras）经全局事件切换
  useEffect(() => {
    const onToggle = () => setTerminalOpen((v) => !v);
    window.addEventListener("mirach:toggle-terminal", onToggle);
    return () => window.removeEventListener("mirach:toggle-terminal", onToggle);
  }, []);

  // 滚动条智能显隐（对话区 + 左侧栏，共用）：滚动中给容器打
  // data-mirach-scrolling（index.css 的 thumb 只在它/悬停时显示），
  // 2 秒无滚动移除 → 自动隐藏。各自独立计时（两个容器同时滚动互不干扰）。
  useEffect(() => {
    const timers = new Map<Element, number>();
    const onScroll = (e: Event) => {
      const sb = (e.target as HTMLElement | null)?.closest?.(
        '.dsh-native-area [class*="_scrollBody"], .dsh-native-area [data-slot="sidebar"] .overflow-y-auto',
      );
      if (!sb) return;
      sb.setAttribute("data-mirach-scrolling", "true");
      const prev = timers.get(sb);
      if (prev !== undefined) window.clearTimeout(prev);
      timers.set(
        sb,
        window.setTimeout(() => {
          sb.removeAttribute("data-mirach-scrolling");
          timers.delete(sb);
        }, 2000),
      );
    };
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("scroll", onScroll, true);
      for (const t of timers.values()) window.clearTimeout(t);
    };
  }, []);

  // 6 个 Mirach 环境（hermes 主环境 + chat/code/work/finance/write 5 模式）对应独立环境：
  // 切换模式 = 切换环境身份（左侧栏团队名联动），主内容区保持对话区。
  // 仅工具类视图（收藏/知识库等）渲染专属视图页。
  const viewPage = activeView === "mirach" || activeView === "chat" || activeView === "code" || activeView === "work" || activeView === "finance" || activeView === "write"
    ? null
    : activeView;

  // 对话区唯一形态：官方根树（官方 ChatView + 官方 Composer 原生融合，官方更新即跟随）。
  // 终端面板挂在官方对话区下方（官方输入条里的 mirach「终端」控件经全局事件切换）。
  return (
    // 主面板【不建】isolate 层叠上下文：isolate 会把整个面板压到 z-0 层，搜索框(z-50)/
    // 展开按钮等头部控件会沉到 TopBar(z-10) 下面无法点击（Tauri 下 TopBar 拦截点击）。
    // E3E6EC 背景用 z-0 + 内容 relative（DOM 靠后绘制在上）实现"内容盖背景"。
    <main className={cn("relative flex shrink-0 flex-col bg-white", className)} style={style}>
      {/* 主对话区背景圆角层已移入官方 centerCol::before（index.css）——
          与官方内容同一容器、同帧绘制，拖动左栏手柄时背景与内容永远
          同步（消除跨树变量同步的帧差错位/文字溢出背景）。 */}
      {/* 内容容器 relative：盖住背景（同层 z-0，DOM 靠后绘制在上）。
          顶栏（HeaderSection）在下方分支内以覆盖层形式渲染（官方侧栏列除外），
          因此主内容区（含官方侧栏列）从面板顶部开始。 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {viewPage ? (
          <>
            {/* 官方树常驻（侧栏列 = mirach 侧栏外壳，所有视图下可用）；
                ViewPage 绝对覆盖对话列（left 避开官方侧栏列，折叠态下
                盖到 280 对功能无碍，仅对话列露出部分） */}
            <NativeChatArea sessionId={activeId} />
            <div
              className="absolute inset-y-0 right-0 z-10 flex min-h-0 flex-col bg-white"
              style={{ left: sidebarCollapsedState ? 0 : "var(--mirach-internal-sidebar-w, 280px)" }}
            >
              <ViewPage view={viewPage} />
            </div>
          </>
        ) : (
          <>
            {/* 官方树全高（侧栏列 = mirach 侧栏，从面板顶开始）；
                mirach 顶栏以覆盖层形式悬浮在官方对话列顶部
                （官方 titleRow 由 index.css 隐藏，官方"对话/轨迹"tabs
                位于顶栏会话名称下方） */}
            <div
              className="relative flex min-h-0 flex-1 flex-col"
              style={{ "--mirach-terminal-h": terminalOpen ? `${terminalH + 20}px` : undefined } as React.CSSProperties}
            >
              <NativeChatArea sessionId={activeId} />
              {/* 终端区：盖在对话列下方（absolute + 只压缩 centerCol 内部：
                  centerCol 底部 padding-bottom 由 --mirach-terminal-h 让位，
                  侧栏列保持全高，不随终端压缩"跟着上去"） */}
              {terminalOpen && (
                <div
                  className="absolute bottom-0 z-10 flex flex-col"
                  style={{
                    left: "var(--mirach-internal-sidebar-w, 280px)",
                    right: 0,
                    height: terminalH + 20,
                  }}
                >
                  <ResizeHandle onDrag={dragTerminal} />
                  <div className="flex-1 min-h-0">
                    <TerminalPanel height={terminalH} onClose={() => setTerminalOpen(false)} />
                  </div>
                </div>
              )}

              {/* 顶栏（项目名/会话名/插件条/命令搜索）：覆盖官方对话列顶部，
                  left 从官方侧栏列右缘起（展开 var 同步 280；折叠时用 React
                  状态直接归零——官方 grid 已把侧栏列折叠为 0，宽度变量可能
                  残留 56 导致顶栏/tabs 左移错位）。
                  布局参考 my-hermes-rs：顶栏透明（无背景色），E3E6EC 圆角层
                  透出为其背景面。侧栏折叠时：侧栏本体隐藏，圆形"展开左侧栏"
                  图标移到项目名左边。 */}
              {(() => {
                const overlayJsx = (
                  <div
                    data-mirach-topbar-overlay
                    className="pointer-events-none absolute top-0 right-0 z-20 flex flex-col items-stretch"
                    style={{ left: 0 }}
                  >
                {/* 第一行：顶栏（85px）——折叠态圆形展开按钮 + 项目名/插件/搜索 */}
                <div className="flex items-center">
                  {sidebarCollapsedState && (
                    <button
                      onClick={() => void nativeToggleSidebar()}
                      title="展开左侧栏"
                      // mt-[14px]：与邻居 HeaderSection 的 paddingTop 一致，
                      // 使按钮中心与"项目名"同一条水平线
                      className="ml-4 mt-[14px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#464646] hover:bg-muted transition-colors"
                    >
                      <PanelLeftOpen className="h-6 w-6" strokeWidth={2} />
                    </button>
                  )}
                  <HeaderSection width={mainW} showLeft={showLeft} onExpandLeft={onExpandLeft ?? (() => {})} palette={palette} onOpenPlugins={onOpenPlugins} />
                </div>
                {/* 第二行：会话名（官方"对话/轨迹"标签页的左侧同行；
                    官方 tabs 经 index.css padding-left 右移让位）。
                    描边线 = 本行底部左右各留 15px 的内缩细线
                    （与左侧栏 HeaderRule 的 inset-x-[15px] 一致）。 */}
                <div
                  className="relative flex items-center"
                  // 会话名与项目名左对齐：跟随第一行的左侧占用（外层展开按钮 52px
                  // + 标题块左内边距 20px；侧栏展开按钮存在时再多让 40px）。
                  style={{
                    height: 32,
                    paddingLeft: (sidebarCollapsedState ? 52 : 0) + (showLeft ? 20 : 60),
                  }}
                >
                  <div className="pointer-events-none absolute inset-x-[15px] bottom-0 h-px bg-[#D1D5DB] dark:bg-[#3a3a3a]" />
                  {/* 与会话名同排的官方 tabs 行：文字与左侧栏"团队列表"同规格
                      （14px body-sm、muted-foreground 灰），垂直中心与之一致
                      （实测差 9px，translate 上移补齐，不扰动 tabs 布局） */}
                  <p
                    title={topSessionTitle}
                    className="min-w-0 truncate text-body-sm text-muted-foreground leading-none -translate-y-[1px]"
                  >
                    {topSessionTitle}
                  </p>
                </div>
                  </div>
                );
                // 与官方内容同一容器（centerCol）同帧绘制；未就绪时原位渲染兜底
                return centerColEl !== null ? createPortal(overlayJsx, centerColEl) : overlayJsx;
              })()}

              {/* 引擎提问卡（ask_user_question 待答）置顶栏下方，不挤压官方树 */}
              {pendingQuestions && (
                <div
                  className="absolute right-5 z-20"
                  style={{ top: 85, left: "calc(var(--mirach-internal-sidebar-w, 280px) + 20px)" }}
                >
                  <UserQuestionCard batch={pendingQuestions} />
                </div>
              )}

              {/* 工具按钮（对话区右上角、StatusWindow 左侧）：聊天记录/详细模式/运行轨迹/Plan */}
              <ChatToolButton detailsExpanded={detailsExpanded} onToggleDetails={toggleDetails} />
              {/* 详细模式切换 toast 反馈 */}
              {detailsToast && (
                <div className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white shadow-md">
                  {detailsExpanded ? "详细模式" : "简洁模式"}
                </div>
              )}
              {/* 活动窗口（顶栏下方右缘浮动：队列/后台进程/子代理/待办/目标/终端活动，
                  可折叠 + 自动展开开关；官方树不提供此面板，属 mirach 自有功能） */}
              <StatusWindow />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
