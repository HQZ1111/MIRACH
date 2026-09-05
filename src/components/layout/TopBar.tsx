/**
 * TopBar — 顶栏 (85px, 透明，绝对定位覆盖内容区)
 *
 * 顶部控件（贴顶右上角）：
 * - Mirach 文件夹（图标 + 文字）· 触感反馈 · 窗口控制圆点（关闭/最大化/最小化，置最右上角）
 * - 右侧栏收放圆点：位于最小化圆点左侧（右侧栏可见=实心，隐藏=空心）
 *
 * 正在运行的终端按钮已移至主页面状态窗口（StatusWindow，自动展开开关左侧）。
 * 工具菜单已移至右侧工具栏。
 */

import { cn } from "@/lib/utils";
import { Folder, Volume2, VolumeX } from "lucide-react";
import type { CSSProperties } from "react";
import { useHaptics } from "@/hooks/useHaptics";
import { useAppConfig } from "@/hooks/useAppConfig";
import { openPath } from "@tauri-apps/plugin-opener";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface TopBarProps {
  className?: string;
  style?: CSSProperties;
  /** 右侧栏当前是否可见（收放按钮图标随状态切换） */
  showRight?: boolean;
  /** 点击收放按钮：切换右侧栏显隐 */
  onToggleRight?: () => void;
}

// ---- 窗口控制（最小化/最大化/关闭；低饱和度圆点，置最右上角；Tauri 环境真实生效） ----

/**
 * 最大化走 Rust 侧 toggle_main_maximize：Win32 SetWindowPos 直控 HWND 到
 * 显示器工作区（原边界由命令内部保存用于还原）。前端 JS API
 * （toggleMaximize / setPosition+setSize）在 decorations:false + transparent:true
 * 的窗口上被包装层/WM 约束，实测只"抖动换位不放大"，故下沉到原生。
 */
export const WINDOW_DOTS = [
  {
    title: "最小化",
    color: "#52B85E", // 绿
    action: async () => {
      try {
        await getCurrentWindow().minimize();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },
  },
  {
    title: "最大化 / 还原",
    color: "#E3A93C", // 琥珀
    action: (() => {
      // 连点保护：SC_MAXIMIZE/SC_RESTORE 是异步动画，GetWindowPlacement 的状态
      // 在动画完成前滞后——250ms 内的第二次点击会把状态翻转回去（表现为"点了没反应"）。
      let last = 0;
      return async () => {
        const now = Date.now();
        if (now - last < 250) return;
        last = now;
        try {
          // Rust 侧 WM_SYSCOMMAND SC_MAXIMIZE/SC_RESTORE：本机实测唯一不回弹的
          // 路径（tao 的 set_maximized 与 SetWindowPos 自管边界在无边框透明窗上
          // 都会闪回；系统命令由 Windows 维护还原边界与任务栏排除）。
          await invoke("toggle_main_maximize");
        } catch {
          /* 非 Tauri 环境：忽略 */
        }
      };
    })(),
  },
  {
    title: "关闭",
    color: "#E2584F", // 红
    action: async () => {
      try {
        await getCurrentWindow().close();
      } catch {
        /* 非 Tauri 环境忽略 */
      }
    },
  },
] as const;

// 窗口拖动走 data-tauri-drag-region（header 声明；浏览器/vite 下无效果，交互簇 data-no-drag 排除）

export function TopBar({ className, style, showRight = true, onToggleRight }: TopBarProps) {
  const { trigger, muted, toggle } = useHaptics();
  // Mirach 文件夹路径来自 Rust 侧配置（MIRACH_HOME / config.json）
  const { config } = useAppConfig();
  const hermesFolder = config.mirachHome;

  // 触感反馈开关（复刻原型：开→关先播 tap 再静音；关→开解除后一帧播 success）
  const toggleHaptics = () => {
    if (!muted) {
      trigger("tap", "haptics-toggle");
    }
    toggle();
    if (muted) {
      window.requestAnimationFrame(() => trigger("success", "haptics-toggle"));
    }
  };

  // 打开 Mirach 文件夹（Tauri 环境；浏览器环境静默失败）
  const openMirachFolder = async () => {
    try {
      if (hermesFolder) {
        await openPath(hermesFolder);
      }
    } catch {
      /* 非 Tauri 环境忽略 */
    }
  };

  // 顶栏空白处按住拖动窗口：Tauri 原生 data-tauri-drag-region（header 上声明，
  // 交互按钮簇 data-no-drag 排除）；浏览器/vite 下无效果。透明窗口下比手动 startDragging 可靠。

  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex items-center bg-transparent pl-5 select-none shrink-0",
        className,
      )}
      style={style}
    >
      {/* 顶置簇（贴顶右上角，无顶部间距）：文件夹 + 触感反馈 + 右侧栏圆点 + 窗口圆点
          right-6(24px)：最右红点中心距卡片右缘 = 24 + 红点半宽6 = 30px
          data-no-drag：整簇排除拖拽，按钮点击正常 */}
      <div data-no-drag className="pointer-events-auto absolute right-[39px] top-0 flex items-center gap-2">
        {/* Mirach 文件夹（图标 + 文字，与触感反馈按钮同高同图标尺寸） */}
        <button
          onClick={openMirachFolder}
          title={`打开 Mirach 文件夹（${hermesFolder || "未配置"}）`}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-[#303030] transition-colors hover:bg-black/5"
        >
          <Folder className="h-4 w-4" strokeWidth={2} />
          <span>Mirach</span>
        </button>

        {/* 触感反馈开关（未静音显示 Volume2，静音显示 VolumeX） */}
        <button
          onClick={toggleHaptics}
          title={muted ? "开启触感反馈" : "关闭触感反馈"}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-colors hover:bg-black/5",
            muted ? "text-[#9CA3AF]" : "text-[#464646]",
          )}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" strokeWidth={2} />
          ) : (
            <Volume2 className="h-4 w-4" strokeWidth={2} />
          )}
        </button>

        {/* 窗口控制（低饱和度圆点，置最右上角，避开圆角；间距 gap-3）+ 右侧栏收放圆点（最小化左侧） */}
        <div className="ml-1 flex items-center gap-3">
          {/* 右侧栏收放圆点：可见=深靛蓝实心，隐藏=浅靛蓝实心（与窗口控制同尺寸，靛蓝区分于绿/琥珀/红） */}
          <button
            onClick={() => {
              trigger("tap", "sidebar-toggle");
              onToggleRight?.();
            }}
            title={showRight ? "收起右侧栏" : "展开右侧栏"}
            className={cn(
              "h-3 w-3 rounded-full border transition-[transform,filter,background-color] hover:scale-125 hover:brightness-110",
              showRight ? "border-[#6366F1] bg-[#6366F1]" : "border-[#C7D2FE] bg-[#C7D2FE]",
            )}
          />
          {WINDOW_DOTS.map((d) => (
            <button
              key={d.title}
              title={d.title}
              onClick={() => void d.action()}
              className="h-3 w-3 rounded-full transition-[transform,filter] hover:scale-125 hover:brightness-110"
              style={{ backgroundColor: d.color }}
            />
          ))}
        </div>
      </div>
    </header>
  );
}
