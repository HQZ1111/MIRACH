/**
 * RightToolbar — 右侧工具栏 (60px × 815px，位于顶栏下方，白色背景)
 *
 * 布局：
 * ┌──────┐
 * │ 上部工具区 485px（顶部往下） │
 * │   💬 其他项目对话            │
 * │   🔍 审查                   │
 * │   ▣ 终端                    │
 * │   🌐 浏览器                 │
 * ├────────────────────────────┤
 * │ 下部工具区 330px（底部往上） │
 * │   ☰ 工具菜单（版本/更新上方，│
 * │      点开在左侧弹下拉）       │
 * │   ⟳ 版本/更新（悬停显版本，  │
 * │      点击弹更新面板）        │
 * │   ◉ 网关状态（#009292 青）   │
 * │   🔑 锁定页面               │
 * │   （底部留白 20px）          │
 * └────────────────────────────┘
 *
 * - 图标：Phosphor Icons, weight="fill", size=24
 * - 按钮：h-10 w-10，gap-1；选中态 #303030 / 未选中 #464646
 * - 网关连接正常恒为 #009292
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { RIGHT_TOOLBAR_WIDTH } from "@/lib/layout";
import { APP_VERSION } from "@/lib/constants";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { MOCK } from "@/lib/mock";
import { useStore } from "@nanostores/react";
import { $gatewayState, pingGateway } from "@/store/gateway";
import { lockApp } from "@/store/password";
import { getToolMenuActions, type PluginIcon } from "@/plugins/registry";
import {
  ArrowClockwise,
  BookOpen,
  ChatText,
  ChatsCircle,
  DownloadSimple,
  FolderSimple,
  GitBranch,
  Globe,
  Keyhole,
  List,
  MagnifyingGlass,
  Moon,
  Plug,
  PuzzlePiece,
  Robot,
  Sparkle,
  Star,
  Sun,
  TerminalWindow,
  UserCircle,
} from "@phosphor-icons/react";

// 工具菜单弹窗按需加载（重依赖 d3-force/highlight.js 等移出主包，打开时才拉取）
const GitReviewOverlay = lazy(() =>
  import("@/components/overlays/GitReviewOverlay").then((m) => ({ default: m.GitReviewOverlay })),
);
const FilesOverlay = lazy(() =>
  import("@/components/overlays/FilesOverlay").then((m) => ({ default: m.FilesOverlay })),
);
const LogsOverlay = lazy(() =>
  import("@/components/overlays/LogsOverlay").then((m) => ({ default: m.LogsOverlay })),
);
const DocsOverlay = lazy(() =>
  import("@/components/overlays/DocsOverlay").then((m) => ({ default: m.DocsOverlay })),
);
const StarmapOverlay = lazy(() =>
  import("@/components/starmap/StarmapOverlay").then((m) => ({ default: m.StarmapOverlay })),
);
const ProfilesOverlay = lazy(() =>
  import("@/components/overlays/ProfilesOverlay").then((m) => ({ default: m.ProfilesOverlay })),
);
const AgentsOverlay = lazy(() =>
  import("@/components/overlays/AgentsOverlay").then((m) => ({ default: m.AgentsOverlay })),
);

// ===== 上半部分工具（顶部往下） =====

interface ToolItem {
  id: string;
  icon: React.ElementType;
  label: string;
  color?: string;
  title?: string;
}

const TOP_ITEMS: ToolItem[] = [
  { id: "assistant", icon: ChatText, label: "辅助对话" },
  { id: "projects", icon: ChatsCircle, label: "其他项目对话" },
  { id: "review", icon: MagnifyingGlass, label: "审查" },
  { id: "terminal", icon: TerminalWindow, label: "终端" },
  { id: "browser", icon: Globe, label: "浏览器" },
];

// ===== 下半部分工具（底部往上：锁定页面 → 主题切换 → 网关状态 → 版本/更新 → 工具菜单） =====
// 主题切换项在组件内动态生成（图标随当前主题变化：浅色 Sun / 深色 Moon）

const BOTTOM_ITEMS: ToolItem[] = [
  { id: "update", icon: ArrowClockwise, label: "版本/更新", title: "Mirach v0.22.0（点击检查更新）" },
  { id: "gateway", icon: Plug, label: "网关状态", color: "#009292", title: "网关：连接正常" },
  { id: "lock", icon: Keyhole, label: "锁定页面" },
];

interface RightToolbarProps {
  className?: string;
  activePanel: string;
  onPanelChange: (panel: string) => void;
}

export function RightToolbar({ className, activePanel, onPanelChange }: RightToolbarProps) {
  // 更新面板状态
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "latest">("idle");
  // 主题切换（浅色/深色两态）
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";
  // 网关/引擎状态（共享 store；真实模式启动探测 + 15s 轮询，mock 恒 open）
  const gatewayState = useStore($gatewayState);
  // 锁定：调用 lockApp 走启动门（StartupGate → LoginPage；未设密码时登录页自动切「设置密码」模式）
  const lock = () => {
    lockApp();
  };
  const gwColor =
    gatewayState === "open"
      ? "#10B981"
      : gatewayState === "connecting"
        ? "#F59E0B"
        : gatewayState === "error"
          ? "#EF4444"
          : "#D1D5DB";
  const gwTitle =
    gatewayState === "open"
      ? "引擎已连接（点击重新检测）"
      : gatewayState === "connecting"
        ? "正在连接引擎…"
        : gatewayState === "error"
          ? "引擎未连接（点击重试）"
          : "引擎未检测（点击检测）";
  const gatewayItem: ToolItem = MOCK
    ? { id: "gateway", icon: Plug, label: "网关状态", color: "#009292", title: "网关：连接正常（mock）" }
    : { id: "gateway", icon: Plug, label: "网关状态", color: gwColor, title: gwTitle };
  // 锁定页面上方的主题切换项（图标随当前主题：浅色 Sun / 深色 Moon）
  const themeItem: ToolItem = {
    id: "theme",
    icon: isDark ? Sun : Moon,
    label: isDark ? "切换到浅色" : "切换到深色",
    title: isDark ? "当前深色 · 点击切换浅色" : "当前浅色 · 点击切换深色",
  };
  // 锁定（最底部）上方的完整下半部分列表（工具菜单在最上，位于版本/更新上面）
  const bottomItems: ToolItem[] = [
    ...BOTTOM_ITEMS.slice(0, 1), // 版本/更新
    gatewayItem,                 // 网关/引擎状态（真实探活）
    themeItem,                   // 主题切换（锁定上面）
    BOTTOM_ITEMS[2],             // 锁定页面（最底部）
  ];

  // ---- 工具菜单（位于版本/更新上方）：Git Review / 文件树 / 导出日志 / 产品文档 / 记忆星图 / 插件 ----
  const [toolOpen, setToolOpen] = useState(false);
  const [toolOverlay, setToolOverlay] = useState<null | "git" | "files" | "logs" | "docs" | "starmap" | "profiles" | "agents">(null);

  // 外部打开 Git Review（对话区"已更改文件"行的审查按钮 → mirach:open-git-review）
  useEffect(() => {
    const onOpenReview = () => setToolOverlay("git");
    window.addEventListener("mirach:open-git-review", onOpenReview);
    return () => window.removeEventListener("mirach:open-git-review", onOpenReview);
  }, []);

  const TOOL_MENU: { id: string; icon: React.ElementType; label: string; run: () => void }[] = [
    { id: "git", icon: GitBranch, label: "Git Review", run: () => setToolOverlay("git") },
    { id: "files", icon: FolderSimple, label: "文件树", run: () => setToolOverlay("files") },
    { id: "logs", icon: DownloadSimple, label: "导出日志", run: () => setToolOverlay("logs") },
    { id: "docs", icon: BookOpen, label: "产品文档", run: () => setToolOverlay("docs") },
    { id: "starmap", icon: Star, label: "记忆星图", run: () => setToolOverlay("starmap") },
    { id: "profiles", icon: UserCircle, label: "档案", run: () => setToolOverlay("profiles") },
    { id: "agents", icon: Robot, label: "代理", run: () => setToolOverlay("agents") },
  ];

  // 插件贡献的菜单项（src/plugins/registry.ts）
  const PLUGIN_ICONS: Record<PluginIcon, React.ElementType> = {
    git: GitBranch,
    folder: FolderSimple,
    log: DownloadSimple,
    doc: BookOpen,
    star: Star,
    sparkles: Sparkle,
    plugin: PuzzlePiece,
  };
  const menuItems = [
    ...TOOL_MENU,
    ...getToolMenuActions().map((p) => ({ id: p.id, icon: PLUGIN_ICONS[p.icon] ?? Sparkle, label: p.label, run: p.run })),
  ];

  const renderItem = (item: ToolItem) => (
    <Button
      key={item.id}
      variant={activePanel === item.id ? "secondary" : "ghost"}
      size="icon"
      className="h-10 w-10"
      title={item.title ?? item.label}
      onClick={() => {
        if (item.id === "update") {
          setUpdateOpen((v) => !v);
          setUpdateState("idle");
        } else if (item.id === "theme") {
          toggle();
        } else if (item.id === "gateway") {
          // 点击重新探活引擎（mock 恒 open，幂等）
          void pingGateway();
        } else if (item.id === "lock") {
          // 锁定页面：与软件启动时输密码的页面一致（StartupGate → LoginPage）
          lock();
        } else {
          onPanelChange(item.id);
        }
      }}
    >
      <item.icon
        weight="fill"
        size={24}
        color={item.color ?? (activePanel === item.id ? "var(--tool-icon-active)" : "var(--tool-icon-inactive)")}
      />
    </Button>
  );

  return (
    <>
      <nav
        className={cn("relative flex flex-col shrink-0 bg-white", className)}
        style={{
          width: RIGHT_TOOLBAR_WIDTH,
          height: "calc(100% - 85px)",
          marginTop: 85,
        }}
      >
        {/* ===== 上部工具区（占据剩余高度，图标靠上），随卡片高度伸缩 ===== */}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-1 py-2">
          <div className="flex flex-1 flex-col items-center gap-1 justify-start pt-1">
            {TOP_ITEMS.map(renderItem)}
          </div>
        </div>

        {/* ===== 下部工具区（锚定底部，底部留白 20px 恒定） ===== */}
        <div className="flex shrink-0 flex-col items-center gap-1 py-2 pb-[20px]">
          <div className="flex flex-1 flex-col items-center gap-1 justify-end pt-1">
            {/* 工具菜单（位于版本/更新上方；点开在工具栏左侧弹出下拉） */}
            <div className="relative">
              <Button
                variant={toolOpen ? "secondary" : "ghost"}
                size="icon"
                className="h-10 w-10"
                title="工具菜单"
                onClick={() => setToolOpen((v) => !v)}
              >
                <List weight="fill" size={24} color={toolOpen ? "#303030" : "#464646"} />
              </Button>
              {toolOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setToolOpen(false)} />
                  <div className="panel-glass menu-anim absolute right-full top-1/2 z-40 mr-2 w-48 -translate-y-1/2 rounded-xl py-1">
                    {menuItems.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setToolOpen(false);
                          item.run();
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-body-sm text-[#303030] transition-colors hover:bg-muted"
                      >
                        <item.icon size={14} weight="fill" color="#9CA3AF" className="shrink-0" />
                        <span className="flex-1">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {bottomItems.map(renderItem)}
          </div>

          {/* ---- 更新面板（点击版本图标弹出） ---- */}
          {updateOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setUpdateOpen(false)} />
              <div className="panel-glass menu-anim absolute right-full top-1/2 z-40 mr-2 w-56 -translate-y-1/2 rounded-xl p-3">
                <p className="text-xs font-medium text-[#303030]">Mirach Harness Ultra</p>
                <p className="mt-1 text-xs text-muted-foreground">当前版本：v{APP_VERSION}</p>
                <button
                  className="mt-2.5 w-full rounded-md bg-foreground px-3 py-1.5 text-xs text-background transition-colors hover:bg-foreground/90"
                  onClick={() => {
                    if (updateState === "idle") {
                      setUpdateState("checking");
                      window.setTimeout(() => setUpdateState("latest"), 1000);
                    }
                  }}
                >
                  {updateState === "checking"
                    ? "检查中…"
                    : updateState === "latest"
                      ? "已是最新版本 ✓"
                      : "检查更新"}
                </button>
              </div>
            </>
          )}
        </div>
      </nav>

      {/* 工具菜单弹窗（Git Review / 文件树 / 导出日志 / 产品文档 / 记忆星图） */}
      <Suspense fallback={null}>
        {toolOverlay === "git" && <GitReviewOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "files" && <FilesOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "logs" && <LogsOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "docs" && <DocsOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "starmap" && <StarmapOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "profiles" && <ProfilesOverlay onClose={() => setToolOverlay(null)} />}
        {toolOverlay === "agents" && <AgentsOverlay onClose={() => setToolOverlay(null)} />}
      </Suspense>
    </>
  );
}
