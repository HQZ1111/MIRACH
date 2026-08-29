/**
 * AppLayout — 主布局外壳
 *
 * 结构 (1580 × 900)：
 * ┌──────┬───────────┬──────────────────────┬──────────┬──────┐
 * │ 左侧  │  左侧栏   │                      │  右侧栏   │ 右侧 │
 * │工具栏 │ (280px)  │   MainPanel          │ (380px)  │工具栏 │
 * │(70px)│           │                      │          │(60px)│
 * └──────┴───────────┴──────────────────────┴──────────┴──────┘
 *
 * - TopBar 绝对定位覆盖在内容区上方（透明），不挤压下方内容
 * - 侧边栏通过左右工具栏图标切换显隐
 * - 列间分隔条可拖拽调宽；卡片四边/四角可拖拽缩放（模拟窗口缩放）
 */

import { lazy, Suspense, useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@nanostores/react";
import { MOCK } from "@/lib/mock";
import { $gatewayState, pingGateway } from "@/store/gateway";
import { GatewayConnectingOverlay } from "@/components/overlays/GatewayConnectingOverlay";
import { StartupGate } from "@/components/layout/StartupGate";
import { Toaster } from "@/components/ui/Toaster";
import { $startupPhase } from "@/store/password";
import { BootFailureOverlay } from "@/components/overlays/BootFailureOverlay";
import { QuitConfirmOverlay } from "@/components/overlays/QuitConfirmOverlay";
import { PromptDialogOverlay } from "@/components/overlays/PromptDialogOverlay";
import { TopBar } from "./TopBar";
import { LeftToolbar } from "./LeftToolbar";
import { LeftSidebar, type ConvItem } from "./LeftSidebar";
import { MainPanel } from "./MainPanel";
import { RightSidebar } from "./RightSidebar";
import { RightToolbar } from "./RightToolbar";
import { MemberChatPanel } from "@/components/chat/MemberChatPanel";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import { type CommandPaletteAction } from "@/components/command-palette/CommandPalette";
import { useTheme } from "@/hooks/useTheme";
import { $sessions, hasSessionContent } from "@/store/sessions";
import { $activeSessionId, setActiveSession } from "@/store/session";
import { KEYBIND_ACTIONS, bindings, matchCombo } from "@/lib/keybinds";
import { SessionSwitcher } from "@/components/session/SessionSwitcher";
import { SessionDialogOverlay } from "@/components/overlays/SessionDialogOverlay";
import { $sessionDialog, closeSessionDialog } from "@/store/session-dialog";
import { $chatHistoryOpen, closeChatHistory } from "@/store/chat-history";
import { useI18n } from "@/lib/i18n";
import { useWindowMaximized } from "@/hooks/use-window-maximized";
import { createProjectSession, ensureMemberThread, generateMemberReply, now, type ProjectSession } from "@/lib/memberSessions";
import { LEFT_TOOLBAR_WIDTH, RIGHT_TOOLBAR_WIDTH } from "@/lib/layout";
import { ColumnResizeHandle } from "@/components/ui/ResizeHandle";
import { getApi } from "@/lib/api";
import { SESSION_ID, appendSystemMessage, newTaskSession } from "@/store/chat";
import { openPrompt } from "@/store/prompt-dialog";

// 功能弹窗按需加载（减少主包体积，打开时才拉取）
const SettingsOverlay = lazy(() =>
  import("@/components/overlays/SettingsOverlay").then((m) => ({ default: m.SettingsOverlay })),
);
const MessagingOverlay = lazy(() =>
  import("@/components/overlays/MessagingOverlay").then((m) => ({ default: m.MessagingOverlay })),
);
const CommandCenterOverlay = lazy(() =>
  import("@/components/overlays/CommandCenterOverlay").then((m) => ({ default: m.CommandCenterOverlay })),
);
const SkillsOverlay = lazy(() =>
  import("@/components/overlays/SkillsOverlay").then((m) => ({ default: m.SkillsOverlay })),
);
const CronOverlay = lazy(() =>
  import("@/components/overlays/CronOverlay").then((m) => ({ default: m.CronOverlay })),
);
const ArtifactsOverlay = lazy(() =>
  import("@/components/overlays/ArtifactsOverlay").then((m) => ({ default: m.ArtifactsOverlay })),
);
const ProfilesOverlay = lazy(() =>
  import("@/components/overlays/ProfilesOverlay").then((m) => ({ default: m.ProfilesOverlay })),
);
const WebhooksOverlay = lazy(() =>
  import("@/components/overlays/WebhooksOverlay").then((m) => ({ default: m.WebhooksOverlay })),
);
const PluginsOverlay = lazy(() =>
  import("@/components/overlays/PluginsOverlay").then((m) => ({ default: m.PluginsOverlay })),
);
const AgentsOverlay = lazy(() =>
  import("@/components/overlays/AgentsOverlay").then((m) => ({ default: m.AgentsOverlay })),
);
const StarmapOverlay = lazy(() =>
  import("@/components/starmap/StarmapView").then((m) => ({ default: m.StarmapView })),
);
const ChatHistoryOverlay = lazy(() =>
  import("@/components/overlays/ChatHistoryOverlay").then((m) => ({ default: m.ChatHistoryOverlay })),
);
const KanbanBoardLazy = lazy(() =>
  import("@/components/kanban/KanbanBoard").then((m) => ({ default: m.KanbanBoard })),
);

// ---- 视图/面板类型 ----

type ViewId =
  | "mirach" | "chat" | "code" | "work" | "finance" | "write"
  | "bookmarks" | "cron" | "settings" | "messaging"
  | "knowledge" | "commands" | "extensions";

// 左工具栏图标 → 原型功能 Overlay（设置/消息平台/命令中心/技能与工具/排程/档案/代理）
type OverlayView =
  | "settings" | "messaging" | "commands" | "skills" | "cron" | "artifacts"
  | "profiles" | "agents" | "webhooks" | "plugins" | "knowledge" | "kanban";

const OVERLAY_BY_VIEW: Partial<Record<string, OverlayView>> = {
  settings: "settings",
  messaging: "messaging",
  commands: "commands",
  extensions: "skills",
  cron: "cron",
  profiles: "profiles",
  agents: "agents",
  knowledge: "knowledge",
};

// 是否运行在 Tauri（浏览器/vite 下顶栏不启用拖拽区，保持透明点击）
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type RightPanelId =
  | "assistant" | "projects" | "files" | "review" | "terminal" | "browser"
  | "artifacts" | "usage" | "update" | "gateway" | "lock" | "theme";

// ---- 默认/可调宽度常量 ----

const LEFT_SIDEBAR_W = 280;   // 左侧栏固定宽度（不参与拖拽）
const RIGHT_SIDEBAR_W = 380;  // 右侧栏默认宽度（可拖拽调节）
const COL_W = 380;            // 子对话栏默认宽度（可拖拽调节）
const MIN_COL_W = 350;        // 子对话栏 / 右侧栏 最小宽度（最大不设限）
const MIN_MAIN_W = 350;       // 主对话栏最小宽度
// 面板 = 窗口视口 − 2×固定阴影边距（40px 恒定，任何窗口尺寸/状态都一致）。
// 最大化时窗口铺满桌面 → 面板 = 桌面 − 80，四周留 40px 阴影环；
// 移动窗口不改变面板尺寸（动态边距方案会随拖动跳动，已废弃）。
const PANEL_MARGIN = 40;
const PANEL_MIN_W = 1220; // tauri.conf minWidth 1300 − 80
const PANEL_MIN_H = 720;

// ================================================================
// 组件
// ================================================================

export function AppLayout() {
  const { t } = useI18n();
  // ---- 状态：当前视图（默认 Mirach 主环境）、右侧面板、侧边栏显隐、选中成员 ----
  const [activeView, setActiveView] = useState<ViewId>("mirach");
  // 右侧栏：真实激活标签（RightSidebar 上报，toggle 判断/工具栏高亮用）
  const [rightTab, setRightTab] = useState<string | null>(null);
  // 外部打开请求（seq 递增 → RightSidebar 每次点击都重新打开对应标签，避免同值不重渲染）
  const [rightOpenReq, setRightOpenReq] = useState<{ id: string; seq: number } | null>(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(false);
  const [selectedMember, setSelectedMember] = useState<ConvItem | null>(null);
  // ---- 列宽（列间分隔条拖拽调节；左侧栏固定 280 不参与拖拽） ----
  const [memberW, setMemberW] = useState(COL_W);
  // 视口尺寸（窗口 client 区）→ 面板 = 视口 − 2×阴影边距，跟随窗口缩放/最大化
  const [viewport, setViewport] = useState({
    w: window.innerWidth,
    h: window.innerHeight,
  });
  useEffect(() => {
    const onWinResize = (): void => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onWinResize);
    return () => window.removeEventListener("resize", onWinResize);
  }, []);
  // 最大化 → 阴影整个减掉：边距/圆角/阴影全零，面板铺满桌面工作区；
  // 悬浮 → 面板 = 窗口 − 2×40 固定阴影边距
  const maximized = useWindowMaximized();
  const panelMargin = maximized ? 0 : PANEL_MARGIN;
  const panelRadius = maximized ? 0 : 40;
  const panelW = maximized ? viewport.w : Math.max(PANEL_MIN_W, viewport.w - PANEL_MARGIN * 2);
  const panelH = maximized ? viewport.h : Math.max(PANEL_MIN_H, viewport.h - PANEL_MARGIN * 2);
  const [rightW, setRightW] = useState(RIGHT_SIDEBAR_W);
  // ---- 软件面板（白色圆角 1580×900 = 设计默认，勿改）；透明窗口 = 面板 + 40px 阴影边距 ----
  const panelRef = useRef<HTMLDivElement | null>(null);
  // 供拖拽回调读取最新布局（避免闭包过期）
  const layoutRef = useRef({
    memberW,
    rightW,
    showLeft,
    showRight,
    hasMember: !!selectedMember,
  });
  layoutRef.current = {
    memberW,
    rightW,
    showLeft,
    showRight,
    hasMember: !!selectedMember,
  };
  // 功能 Overlay（设置/消息平台/命令中心/技能与工具/排程）
  const [overlayView, setOverlayView] = useState<OverlayView | null>(null);
  // 会话对话框（「在新窗口打开」→ 应用内弹窗）
  const sessionDialogId = useStore($sessionDialog);
  // 聊天记录弹窗（Ctrl+F / 聊天记录工具按钮打开）
  const chatHistoryOpen = useStore($chatHistoryOpen);
  // 启动流程预览（mock 下演示连接动画）
  const [previewStartup, setPreviewStartup] = useState<"connecting" | null>(null);
  // ---- 引擎网关探活 / 故障浮层（真实模式；mock 恒 open 不触发） ----
  // 首启不再引导填地址：直接用默认引擎地址（config engineBase，默认 http://127.0.0.1:8787）
  // 探活，不通走 BootFailure（重试 / 去设置连接）。打包后的安装位置等由系统安装器负责。
  const gatewayState = useStore($gatewayState);
  // 启动门阶段（splash/locked/ready）：真实网关浮层在 ready 后才显示，避免与启动动画叠加
  const startupPhase = useStore($startupPhase);
  const [bootDismissed, setBootDismissed] = useState(false);
  useEffect(() => {
    if (MOCK) return;
    void pingGateway();
  }, []);
  // 新窗口深链：?sessionId=xxx → 激活对应会话（Tauri 新窗口 / 浏览器降级新标签页共用）
  useEffect(() => {
    const sid = new URLSearchParams(window.location.search).get("sessionId");
    if (!sid) return;
    const exists = $sessions.get().some((s) => s.id === sid);
    if (exists) {
      setActiveSession(sid);
      setShowLeft(true);
    }
  }, []);
  // ⌘K 命令面板
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 命令面板查询（主栏顶部搜索框输入值；搜索框替代弹窗自带搜索）
  const [paletteQuery, setPaletteQuery] = useState("");
  // 命令面板深链：设置分区 / 命令中心标签
  const [settingsSection, setSettingsSection] = useState("general");
  const [ccTab, setCcTab] = useState("sessions");
  // 主题（命令面板"外观"分组用）
  const { toggle: toggleTheme, setTheme } = useTheme();

  // 全局快捷键：由可重绑定动作表驱动（设置页 Keybinds 可改绑定）。
  // ⌘K 命令面板 / ⌘N 新会话 / ⌘] 切会话 / ⌘J 会话切换器 / ⌘B 左栏 /
  // ⌘⇧B 右栏 / ⇧X 主题
  const [jumpOpen, setJumpOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const cur = bindings();
      const hit = KEYBIND_ACTIONS.find(
        (a) => !a.fixed && matchCombo(e, cur[a.id] ?? a.defaultCombo),
      );
      if (!hit) return;
      // 输入框聚焦时放行纯字符类快捷键（保持输入）；仅动作命中才拦截
      e.preventDefault();
      switch (hit.id) {
        case "commandPalette":
          setPaletteOpen((v) => !v);
          break;
        case "newSession": {
          setActiveSession(newTaskSession());
          setShowLeft(true);
          break;
        }
        case "switchSession": {
          // 对齐 dsh：只循环有内容的会话（空白会话已从列表隐藏）
          const list = $sessions.get().filter((s) => !s.archived && hasSessionContent(s.id));
          if (list.length === 0) break;
          const idx = list.findIndex((s) => s.id === $activeSessionId.get());
          const next = list[(idx + 1) % list.length];
          setActiveSession(next.id);
          break;
        }
        case "jumpSession":
          setJumpOpen(true);
          break;
        case "toggleSidebar":
          setShowLeft((v) => !v);
          break;
        case "toggleRightSidebar":
          setShowRight((v) => !v);
          break;
        case "toggleTheme":
          toggleTheme();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme]);
  // 项目固定会话（跟随主项目建立；成员对话是其下的成员线程）
  const [projectSession, setProjectSession] = useState<ProjectSession>(() => createProjectSession());

  // ---- 点击成员：展开子对话栏；再次点击同一成员收起（默认收起） ----
  const openMember = (member: ConvItem) => {
    setSelectedMember((prev) => (prev && prev.id === member.id ? null : member));
    // 确保该成员线程存在（幂等，首次打开时创建）
    setProjectSession((s) => ensureMemberThread(s, member));
  };

  // ---- 成员对话发送：追加用户消息到该成员线程 → 模拟思考后回复 ----
  const sendMemberMessage = (memberId: string, text: string) => {
    setProjectSession((s) => ({
      ...s,
      memberThreads: {
        ...s.memberThreads,
        [memberId]: [
          ...(s.memberThreads[memberId] ?? []),
          { id: `u${Date.now()}`, role: "user", text, time: now() },
        ],
      },
    }));
    // 模拟成员思考（2s 后回复，引用项目上下文）
    const member = selectedMember;
    window.setTimeout(() => {
      setProjectSession((s) => ({
        ...s,
        memberThreads: {
          ...s.memberThreads,
          [memberId]: [
            ...(s.memberThreads[memberId] ?? []),
            {
              id: `r${Date.now()}`,
              role: "member",
              text: generateMemberReply(member ?? ({ name: "成员" } as ConvItem), text),
              time: now(),
            },
          ],
        },
      }));
    }, 2000);
  };

  // ---- 收放回调 ----
  const collapseLeft = useCallback(() => setShowLeft(false), []);

  // ---- 列间分隔条拖拽：CSS 变量直驱（拖拽中不触发 React 重渲染，跟手且快） ----
  // 列宽写为卡片上的 --col-member-w / --col-right-w，各栏 width 与分隔条 left 用 var() 引用；
  // 拖拽时只 setProperty 改变量（合成器级），松手才提交 React 状态。
  const dragWRef = useRef({ member: memberW, right: rightW });
  dragWRef.current = { member: memberW, right: rightW };

  const applyColVar = useCallback((name: "member" | "right", px: number) => {
    panelRef.current?.style.setProperty(
      name === "member" ? "--col-member-w" : "--col-right-w",
      `${Math.round(px)}px`,
    );
  }, []);

  // 主对话栏 | 子对话栏：右拖 dx>0 → 子对话栏变窄（主栏变宽）
  const handleMemberDrag = useCallback((dx: number) => {
    const { rightW, showLeft, showRight } = layoutRef.current;
    const maxByMain = panelW - LEFT_TOOLBAR_WIDTH - RIGHT_TOOLBAR_WIDTH - MIN_MAIN_W
      - (showLeft ? LEFT_SIDEBAR_W : 0) - (showRight ? rightW : 0);
    const n = Math.min(Math.max(dragWRef.current.member - dx, MIN_COL_W), Math.max(MIN_COL_W, maxByMain));
    dragWRef.current.member = n;
    applyColVar("member", n);
  }, [applyColVar]);

  // 子对话栏 | 右侧栏：拖拽在两栏之间重新分配宽度，主对话栏保持不变
  const handleRightDrag = useCallback((dx: number) => {
    const { showLeft, hasMember } = layoutRef.current;
    if (hasMember) {
      const sum = dragWRef.current.member + dragWRef.current.right;
      const nm = Math.min(Math.max(dragWRef.current.member + dx, MIN_COL_W), sum - MIN_COL_W);
      const nr = sum - nm;
      dragWRef.current.member = nm;
      dragWRef.current.right = nr;
      applyColVar("member", nm);
      applyColVar("right", nr);
      return;
    }
    const maxRight = panelW - LEFT_TOOLBAR_WIDTH - (showLeft ? LEFT_SIDEBAR_W : 0) - MIN_MAIN_W - RIGHT_TOOLBAR_WIDTH;
    const nr = Math.min(Math.max(dragWRef.current.right - dx, MIN_COL_W), maxRight);
    dragWRef.current.right = nr;
    applyColVar("right", nr);
  }, [applyColVar]);

  // 松手：把拖拽后的宽度提交到 React 状态（各栏 width 变量经渲染同步，无跳变）
  const commitColDrag = useCallback(() => {
    setMemberW(dragWRef.current.member);
    setRightW(dragWRef.current.right);
  }, []);

  // ---- 主对话栏最小宽度保护：子对话栏/右侧栏同时占宽导致主栏过窄时，优先压缩子对话栏，其次右侧栏 ----
  // 单次计算同时确定两个目标宽度（避免分两步压导致收敛到次优解）
  useEffect(() => {
    const fixed = LEFT_TOOLBAR_WIDTH + RIGHT_TOOLBAR_WIDTH
      + (showLeft ? LEFT_SIDEBAR_W : 0) + MIN_MAIN_W;
    const avail = panelW - fixed; // 子对话栏 + 右侧栏 可占用的总宽度
    const nMember = Math.min(memberW, Math.max(MIN_COL_W, avail - (showRight ? rightW : 0)));
    setMemberW(nMember);
    if (showRight) {
      setRightW(Math.min(rightW, Math.max(MIN_COL_W, avail - nMember)));
    }
  }, [showRight, rightW, showLeft, selectedMember, memberW]);

  // ---- 软件面板 = 白色圆角 1580×900（设计默认，勿改）；悬浮在透明窗口内，阴影在透明边距里 ----

  // ---- 左侧工具栏切换：功能图标打开原型对应 Overlay，其余切换团队视图 ----
  const handleViewChange = useCallback(
    (view: string) => {
      const overlay = OVERLAY_BY_VIEW[view];
      if (overlay) {
        setOverlayView(overlay);
        return;
      }
      setActiveView(view as ViewId);
      setShowLeft(true);
    },
    [],
  );

  // ---- 右侧工具栏切换：总是打开/激活对应面板（永不收起；收起走顶栏「多标签页」标题 / 标签 ×） ----
  const handleRightPanelChange = useCallback(
    (panel: string) => {
      setRightOpenReq({ id: panel, seq: Date.now() });
      setShowRight(true);
    },
    [],
  );

  // ---- ⌘K 命令面板：跳转动作 ----
  const openSettings = useCallback((section: string) => {
    setSettingsSection(section);
    setOverlayView("settings");
  }, []);
  // 简约对话档（zosma ChatView）斜杠命令 /settings → 打开设置浮层；
  // detail.section 可指定分区（如 Composer「编辑模型…」→ model）
  useEffect(() => {
    const onOpenSettings = (e: Event) => {
      const section = (e as CustomEvent<{ section?: string }>).detail?.section;
      setSettingsSection(section ?? "general");
      setOverlayView("settings");
    };
    window.addEventListener("mirach:open-settings", onOpenSettings);
    return () => window.removeEventListener("mirach:open-settings", onOpenSettings);
  }, []);
  const openCC = useCallback((tab: string) => {
    setCcTab(tab);
    setOverlayView("commands");
  }, []);
  const openPanel = useCallback((panel: RightPanelId) => {
    setRightOpenReq({ id: panel, seq: Date.now() });
    setShowRight(true);
  }, []);

  // 产物文件点击（MainPanel openFilePreview）→ 右侧栏切到「预览」面板
  useEffect(() => {
    const onOpenPreview = () => {
      setRightOpenReq({ id: "preview", seq: Date.now() });
      setShowRight(true);
    };
    window.addEventListener("mirach:open-preview", onOpenPreview);
    return () => window.removeEventListener("mirach:open-preview", onOpenPreview);
  }, []);
  /** 插件扩展路由：关闭插件管理器 → 主内容区切到插件注册的页面 */
  const handleOpenPluginView = useCallback((viewId: string) => {
    setOverlayView(null);
    setActiveView(viewId as ViewId);
    setShowLeft(true);
  }, []);

  const paletteActions: CommandPaletteAction[] = useMemo(() => {
    const list: CommandPaletteAction[] = [];
    const add = (
      id: string,
      label: string,
      group: string,
      run: () => void,
      opts?: { hint?: string; keywords?: string },
    ) => list.push({ id, label, group, run, hint: opts?.hint, keywords: opts?.keywords });

    // 跳转
    add("jump.new-chat", "新建会话", "跳转", () => {
      setActiveSession(newTaskSession());
      setShowLeft(true);
    }, { keywords: "新对话 new chat" });
    add("jump.settings", "设置", "跳转", () => openSettings("model"), { keywords: "settings 偏好" });
    add("jump.commands", "命令中心", "跳转", () => openCC("sessions"), { keywords: "command center 会话 系统 用量" });
    add("jump.skills", "技能与工具", "跳转", () => setOverlayView("skills"), { keywords: "skills tools mcp 工具" });
    add("jump.messaging", "消息平台", "跳转", () => setOverlayView("messaging"), { keywords: "messaging telegram 消息" });
    add("jump.cron", "排程任务", "跳转", () => setOverlayView("cron"), { keywords: "cron 定时" });
    add("jump.artifacts", "产物", "跳转", () => setOverlayView("artifacts"), { keywords: "artifacts 文件 图片" });
    add("jump.terminal", "终端", "跳转", () => openPanel("terminal"), { keywords: "terminal pty powershell" });
    add("jump.profiles", "档案", "跳转", () => setOverlayView("profiles"), { keywords: "profiles agent 配置" });
    add("jump.agents", "代理", "跳转", () => setOverlayView("agents"), { keywords: "agents subagent 委派" });
    add("jump.webhooks", "Webhook 订阅", "跳转", () => setOverlayView("webhooks"), { keywords: "webhooks 推送 订阅" });
    add("jump.plugins", "插件", "跳转", () => setOverlayView("plugins"), { keywords: "plugins 扩展 目录" });
    // 启动流程预览（mock 下演示：连接动画 → provider 引导）
    if (MOCK) {
      add("demo.startup", "预览启动流程", "演示", () => setPreviewStartup("connecting"), {
        keywords: "startup 启动 引导 安装 install connecting onboarding 首启",
      });
    }

    // 右侧面板
    add("panel.assistant", "辅助对话", "右侧面板", () => openPanel("assistant"), { keywords: "临时会话" });
    add("panel.projects", "其他项目对话", "右侧面板", () => openPanel("projects"), { keywords: "项目选择" });
    add("panel.review", "审查", "右侧面板", () => openPanel("review"), { keywords: "review git diff" });
    add("panel.browser", "浏览器", "右侧面板", () => openPanel("browser"), { keywords: "webview 网页" });

    // 引擎斜杠命令（真实模式 POST /v1/commands；输出追加到聊天区）
    const engineCmd = (cmd: string) => () => {
      void getApi()
        .runCommand(SESSION_ID, cmd)
        .then((r) => {
          appendSystemMessage(r.accepted ? `⚡ /${cmd} → ${r.output}` : `/${cmd} 未接受：${r.output}`);
        })
        .catch((e: unknown) => {
          appendSystemMessage(`/${cmd} 执行失败：${String(e)}`);
        });
    };
    add("engine.usage", "引擎用量", "引擎", engineCmd("usage"), { hint: "/usage", keywords: "cost 计费 token" });
    add("engine.status", "引擎状态", "引擎", engineCmd("status"), { hint: "/status", keywords: "状态检查" });
    add("engine.stop", "停止运行", "引擎", engineCmd("stop"), { hint: "/stop", keywords: "中断 cancel 停止" });
    add("engine.queue", "排队任务", "引擎", engineCmd("queue"), { hint: "/queue", keywords: "follow-up 队列" });
    add("engine.undo", "撤销上一步", "引擎", engineCmd("undo"), { hint: "/undo", keywords: "回退 rewind" });
    add("engine.resume", "继续运行", "引擎", engineCmd("resume"), { hint: "/resume", keywords: "resume 继续" });
    add("engine.fast", "快速模式", "引擎", engineCmd("fast"), { hint: "/fast", keywords: "快速 turbo" });
    add("engine.steer", "转向纠偏", "引擎", async () => {
      const g = (await openPrompt({
        title: "转向纠偏",
        label: "转向指令（运行中会打断当前任务注入纠偏）",
        placeholder: "输入转向指令",
        confirmText: "发送",
      }))?.trim();
      if (!g) return;
      void getApi()
        .steer(g)
        .then(() => appendSystemMessage(`⚡ 已发送转向：${g}`))
        .catch((e: unknown) => appendSystemMessage(`转向失败：${String(e)}`));
    }, { hint: "/steer", keywords: "steer 纠正 interrupt 转向" });

    // 外观
    add("theme.light", "浅色模式", "外观", () => setTheme("light"), { hint: "Light", keywords: "白色" });
    add("theme.dark", "深色模式", "外观", () => setTheme("dark"), { hint: "Dark", keywords: "黑色 夜间" });
    add("theme.system", "跟随系统", "外观", () => setTheme("system"), { keywords: "auto 自动" });
    add("theme.toggle", "切换深浅色", "外观", () => toggleTheme(), { hint: "Shift+X", keywords: "toggle" });

    // 设置（深链到各分区）
    const settingsSections: [string, string, string][] = [
      ["model", "模型", "model 主模型"],
      ["chat", "对话", "chat 对话行为"],
      ["general", "通用设置", "general 通用 外观 主题 语言 宽度 风格"],
      ["workspace", "工作区", "workspace 目录"],
      ["safety", "安全", "safety 审批"],
      ["memory", "记忆与上下文", "memory 上下文"],
      ["voice", "语音", "voice 朗读 听写"],
      ["advanced", "高级", "advanced"],
      ["notifications", "通知", "notifications 桌面通知"],
      ["billing", "计费", "billing 账单"],
      ["providers", "Providers", "providers 模型供应商"],
      ["gateway", "Gateway", "gateway 网关"],
      ["keybinds", "键盘快捷键", "keybinds 快捷键"],
      ["git", "Git 账户", "git git账户 凭据 密码 登录"],
      ["keys", "工具与密钥", "keys 密钥"],
      ["plugins", "插件", "plugins 扩展"],
      ["sessions", "归档会话", "sessions 已归档"],
      ["about", "关于", "about 版本"],
    ];
    for (const [id, label, keywords] of settingsSections) {
      add(`settings.${id}`, label, "设置", () => openSettings(id), { keywords });
    }

    return list;
  }, [openSettings, openCC, openPanel, setOverlayView, setShowLeft, setTheme, toggleTheme]);

  // TopBar 左侧起始位置：左侧工具栏(70) + 左侧栏(可见时 280)
  const topBarLeft = showLeft ? LEFT_TOOLBAR_WIDTH + LEFT_SIDEBAR_W : LEFT_TOOLBAR_WIDTH;

  // 主内容区宽度 = 软件面板宽 - 左工具栏 - 左侧栏(可见时) - 子对话栏(选中时) - 右侧栏(可见时) - 右工具栏
  // 固定宽度 + transition 让收起/展开平滑过渡（flex-1 无法过渡）
  const mainWidth =
    panelW -
    LEFT_TOOLBAR_WIDTH -
    (showLeft ? LEFT_SIDEBAR_W : 0) -
    (selectedMember ? memberW : 0) -
    (showRight ? rightW : 0) -
    RIGHT_TOOLBAR_WIDTH;

  // ================================================================
  // 渲染
  // ================================================================

  return (
    // 透明画布（tauri 窗口 = 最底层容器，四角透出桌面；WebView 背景已 Rust 设全透明）
    <div className="relative h-screen w-screen">
      {/* 阴影层（文章 ::after 法等价实现）：面板背后、同尺寸同圆角 + box-shadow → 阴影跟 40px 圆角走；
          阴影尺寸适配 40px 透明边距（blur 视觉延伸约 2×，过大会在窗口边裁成断线） */}
      <div
        aria-hidden
        className="absolute"
        style={{
          top: panelMargin,
          left: panelMargin,
          width: panelW,
          height: panelH,
          borderRadius: panelRadius,
          boxShadow: maximized ? "none" : "0 6px 20px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.10)",
        }}
      />
      {/* 软件面板：白色圆角 1580×900（设计默认，勿改），悬浮居中（z 在阴影层之上）。
          transform: translateZ(0) 让面板成为 fixed 的包含块 → 内部所有弹窗/遮罩
          （OverlayShell、启动页、图片预览等）相对面板定位，被 40px 圆角裁剪，
          不会盖到窗口透明边距上（否则 fixed 相对视口会超出软件边界） */}
      <div
        ref={panelRef}
        data-panel
        className="relative flex overflow-hidden bg-white"
        style={{
          top: panelMargin,
          left: panelMargin,
          width: panelW,
          height: panelH,
          borderRadius: panelRadius,
          transform: "translateZ(0)",
          // 列宽 CSS 变量：各栏 width 与分隔条 left 用 var() 引用；
          // 拖拽时只 setProperty 改变量（不触发 React 重渲染，跟手且快）
          "--left-sidebar-w": `${showLeft ? LEFT_SIDEBAR_W : 0}px`,
          "--col-member-w": `${selectedMember ? memberW : 0}px`,
          "--col-right-w": `${showRight ? rightW : 0}px`,
        } as React.CSSProperties}
      >
        {/* ---- TopBar：绝对定位覆盖，透明；Tauri 下 data-tauri-drag-region 拖拽窗口，
              浏览器/vite 下保持 pointer-events-none（不遮挡下方搜索框） ---- */}
        <TopBar
          className={`absolute z-10 ${isTauri ? "" : "pointer-events-none"}`}
          style={{ top: 0, left: topBarLeft, right: 0, height: 85 }}
          showRight={showRight}
          onToggleRight={() => setShowRight((v) => !v)}
        />

        {/* ---- 左侧工具栏 (70px，全高；左侧栏收起时背景转白与主内容区一致) ---- */}
        <LeftToolbar
          activeView={activeView}
          onViewChange={handleViewChange}
          sidebarVisible={showLeft}
        />

        {/* ---- 左侧栏 (固定 280px，可收起) ---- */}
        {showLeft && (
          <LeftSidebar
            activeView={activeView}
            onCollapse={collapseLeft}
            onSelectMember={openMember}
            selectedMemberId={selectedMember?.id ?? null}
            onOpenArtifacts={() => setOverlayView("artifacts")}
            onOpenCron={() => setOverlayView("cron")}
            onOpenKanban={() => setOverlayView("kanban")}
          />
        )}

        {/* ---- 主内容区（宽度用 CSS 变量 calc，拖拽中变量变化即生效、不重渲染） ---- */}
        <MainPanel
          style={{
            width:
              "calc(100% - 70px - var(--left-sidebar-w) - var(--col-member-w) - var(--col-right-w) - 60px)",
          }}
          mainWidth={mainWidth}
          showLeft={showLeft}
          onExpandLeft={() => setShowLeft(true)}
          activeView={activeView}
          palette={{
            open: paletteOpen,
            query: paletteQuery,
            actions: paletteActions,
            onQueryChange: setPaletteQuery,
            onOpen: () => setPaletteOpen(true),
            onClose: () => setPaletteOpen(false),
          }}
        />
        {/* 子内容区：选中成员时显示对话面板；再次点击成员或关闭后收起 */}
        {selectedMember && (
          <MemberChatPanel
            key={selectedMember.id}
            width="var(--col-member-w)"
            member={selectedMember}
            messages={projectSession.memberThreads[selectedMember.id] ?? []}
            onClose={() => setSelectedMember(null)}
            onSend={sendMemberMessage}
          />
        )}
        {/* 右侧栏（收起时隐藏不卸载，保留标签状态；同时由 RightSidebar 清理浏览器 webview） */}
        <RightSidebar
          className={showRight ? undefined : "hidden"}
          showRight={showRight}
          openReq={rightOpenReq}
          onActiveTabChange={setRightTab}
          onCollapse={() => setShowRight(false)}
          style={{ width: "var(--col-right-w)" }}
        />

        {/* ---- 右侧工具栏 (60px，全高) ---- */}
        <RightToolbar
          activePanel={rightTab ?? ""}
          onPanelChange={handleRightPanelChange}
        />

        {/* ---- 列间拖拽分隔条（主|子 / 子|右；左|主 之间不提供，左侧栏固定宽） ---- */}
        {selectedMember && (
          <ColumnResizeHandle
            style={{
              left: "calc(100% - 60px - var(--col-right-w) - var(--col-member-w) - 4px)",
              top: 85,
              bottom: 0,
              width: 8,
            }}
            onDrag={handleMemberDrag}
            onDragEnd={commitColDrag}
          />
        )}
        {showRight && (
          <ColumnResizeHandle
            style={{
              left: "calc(100% - 60px - var(--col-right-w) - 4px)",
              top: 85,
              bottom: 0,
              width: 8,
            }}
            onDrag={handleRightDrag}
            onDragEnd={commitColDrag}
          />
        )}

        {/* ---- 功能 Overlay（设置/消息平台/命令中心/技能与工具/排程/产物，按需加载） ---- */}
        <Suspense fallback={null}>
        {overlayView === "settings" && (
          <OverlayShell
            title={t("settings.title")}
            onClose={() => setOverlayView(null)}
            closeOnBackdrop={false}
            closeOnEsc={false}
          >
            <SettingsOverlay initialSection={settingsSection} onClose={() => setOverlayView(null)} />
          </OverlayShell>
        )}
        {overlayView === "messaging" && (
          <OverlayShell title={t("messaging.title")} onClose={() => setOverlayView(null)}>
            <MessagingOverlay />
          </OverlayShell>
        )}
        {overlayView === "commands" && (
          <OverlayShell title={t("commands.title")} onClose={() => setOverlayView(null)}>
            <CommandCenterOverlay initialTab={ccTab} />
          </OverlayShell>
        )}
        {overlayView === "skills" && (
          <OverlayShell title={t("skills.title")} width={1040} height={720} onClose={() => setOverlayView(null)}>
            <SkillsOverlay />
          </OverlayShell>
        )}
        {overlayView === "cron" && (
          <OverlayShell title={t("cron.title")} onClose={() => setOverlayView(null)}>
            <CronOverlay />
          </OverlayShell>
        )}
        {overlayView === "artifacts" && (
          <ArtifactsOverlay onClose={() => setOverlayView(null)} />
        )}
        {overlayView === "profiles" && (
          <ProfilesOverlay onClose={() => setOverlayView(null)} />
        )}
        {overlayView === "agents" && (
          <AgentsOverlay onClose={() => setOverlayView(null)} />
        )}
        {overlayView === "webhooks" && (
          <WebhooksOverlay onClose={() => setOverlayView(null)} />
        )}
        {overlayView === "plugins" && (
          <PluginsOverlay onClose={() => setOverlayView(null)} onOpenPluginView={handleOpenPluginView} />
        )}
        {overlayView === "knowledge" && (
          <OverlayShell title="知识星空图" width={1100} height={760} onClose={() => setOverlayView(null)}>
            <StarmapOverlay />
          </OverlayShell>
        )}
        {overlayView === "kanban" && (
          <OverlayShell title="看板" width={1280} height={780} onClose={() => setOverlayView(null)}>
            <KanbanBoardLazy />
          </OverlayShell>
        )}
        {/* 聊天记录弹窗（Ctrl+F / 工具按钮） */}
        {chatHistoryOpen && <ChatHistoryOverlay onClose={closeChatHistory} />}
        </Suspense>

        {/* ---- ⌘J 会话切换器 ---- */}
        <SessionSwitcher open={jumpOpen} onClose={() => setJumpOpen(false)} />

        {/* ---- 会话对话框（「在新窗口打开」/ ⌘⇧N → 应用内弹窗） ---- */}
        {sessionDialogId !== undefined && (
          <SessionDialogOverlay sessionId={sessionDialogId} onClose={closeSessionDialog} />
        )}

        {/* ---- 引擎网关：连接中解码动画 / 启动失败（安装层已移除，直接用默认引擎地址） ---- */}
        {startupPhase === "ready" && gatewayState === "connecting" && <GatewayConnectingOverlay />}
        {startupPhase === "ready" && gatewayState === "error" && !bootDismissed && (
          <BootFailureOverlay
            onRetry={() => {
              setBootDismissed(false);
              void pingGateway();
            }}
            onOpenSettings={() => {
              setBootDismissed(true);
              openSettings("gateway");
            }}
            onClose={() => setBootDismissed(true)}
          />
        )}

        {/* ---- 启动流程预览（mock 演示：连接动画） ---- */}
        {previewStartup === "connecting" && (
          <PreviewConnecting onDone={() => setPreviewStartup(null)} />
        )}

        {/* ---- 关闭确认（真实模式，有后台任务运行中时） ---- */}
        <QuitConfirmOverlay />

        {/* ---- 通用文本输入弹窗（替换 window.prompt） ---- */}
        <PromptDialogOverlay />

        {/* ---- 启动门：登录页/过渡页 = 壳内全屏状态，盖住整个软件面板（含顶栏），不碰阴影 ---- */}
        <StartupGate />

        {/* ---- 全局通知浮层（替换 window.alert 的信息提示） ---- */}
        <Toaster />
      </div>
    </div>
  );
}

/**
 * PreviewConnecting — 启动流程预览的"连接中"阶段
 * 叠用 GatewayConnectingOverlay（解码动画）+ Preparing 进度条，满 100% 后推进。
 */
function PreviewConnecting({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => {
      setProgress((p) => Math.min(100, p + 4));
    }, 60);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (progress < 100) return;
    const t = window.setTimeout(onDone, 500);
    return () => window.clearTimeout(t);
  }, [progress, onDone]);

  return (
    <>
      <GatewayConnectingOverlay />
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[81] flex flex-col items-center">
        <div className="h-1 w-64 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#6366F1] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
          正在准备 Mirach… {progress}%（演示预览）
        </p>
      </div>
    </>
  );
}
