/**
 * LeftToolbar — 左侧工具栏 (70px × 900px)
 *
 * 三个区域：
 * ┌──────┐
 * │  H   │  85px   Logo
 * ├──────┤
 * │  💬  │  聊天
 * │  </> │  代码
 * │  💼  │  工作
 * │  📈  │  金融     795px  工具区
 * │  ✏️  │  写作     (上部分从上到下，
 * │  ⭐  │  收藏      下部分从下到上)
 * │  🕐  │  定时
 * │  ▦   │  拓展
 * │  ⌘   │  命令中心
 * │  📖  │  知识库
 * │  📱  │  通讯
 * │  ⚙️  │  设置
 * │  20  │  底部留白
 * └──────┘
 *
 * - 图标：Phosphor Icons, weight="fill", size=24
 * - 选中态：#303030，未选中：#464646
 * - 背景色：#EDEEF0
 */

import { cn } from "@/lib/utils";
import { LEFT_TOOLBAR_WIDTH } from "@/lib/layout";
import { Button } from "@/components/ui/button";
import {
  Chat,
  Code,
  Briefcase,
  ChartLineUp,
  Pen,
  Star,
  Clock,
  Gear,
  DeviceMobile,
  BookOpen,
  Command,
  SquaresFour,
} from "@phosphor-icons/react";

// ===== Tools =====

interface ToolItem {
  id: string;
  icon: React.ElementType;
  label: string;
}

const topTools: ToolItem[] = [
  { id: "chat", icon: Chat, label: "聊天" },
  { id: "code", icon: Code, label: "代码" },
  { id: "work", icon: Briefcase, label: "工作" },
  { id: "finance", icon: ChartLineUp, label: "金融" },
  { id: "write", icon: Pen, label: "写作" },
  { id: "bookmarks", icon: Star, label: "收藏" },
  { id: "cron", icon: Clock, label: "定时任务" },
];

const bottomTools: ToolItem[] = [
  { id: "extensions", icon: SquaresFour, label: "拓展" },
  { id: "commands", icon: Command, label: "命令中心" },
  { id: "knowledge", icon: BookOpen, label: "知识库" },
  { id: "messaging", icon: DeviceMobile, label: "通讯" },
  { id: "settings", icon: Gear, label: "设置" },
];

// ===== Component =====

interface LeftToolbarProps {
  className?: string;
  activeView: string;
  onViewChange: (view: string) => void;
  /** 左侧栏是否可见：收起时工具栏背景切为白色，与主内容区融为一体 */
  sidebarVisible?: boolean;
}

export function LeftToolbar({
  className,
  activeView,
  onViewChange,
  sidebarVisible = true,
}: LeftToolbarProps) {
  return (
    <nav
      // 浅色：侧栏可见 #EDEEF0 / 收起 #FFFFFF；深色：固定 #17191c（zosma 侧栏色，dark: 变体优先于普通类）
      className={cn(
        "flex flex-col shrink-0 transition-colors duration-200 dark:bg-[#17191c]",
        sidebarVisible ? "bg-[#EDEEF0]" : "bg-white",
        className,
      )}
      style={{ width: LEFT_TOOLBAR_WIDTH }}
    >
      {/* ===== Top: Logo (85px) —— 点击进入 Mirach 主环境（全能个人助理） ===== */}
      <div
        className="flex shrink-0 items-center justify-center"
        style={{ height: 85 }}
      >
        <button
          onClick={() => onViewChange("mirach")}
          title="Mirach 主环境"
          className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-[#303030] text-white font-bold text-lg transition-transform hover:scale-105"
        >
          H
        </button>
      </div>

      {/* ===== Middle: main tools，占据剩余高度（图标靠上），随卡片高度伸缩 ===== */}
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 py-2">
        <div className="flex flex-col items-center gap-1 flex-1 justify-start pt-1">
          {topTools.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              title={item.label}
              onClick={() => onViewChange(item.id)}
            >
              <item.icon
                weight="fill"
                size={24}
                color={activeView === item.id ? "var(--tool-icon-active)" : "var(--tool-icon-inactive)"}
              />
            </Button>
          ))}
        </div>
      </div>

      {/* ===== Bottom: utility tools，锚定底部（底部留白 20px 恒定） ===== */}
      <div className="flex shrink-0 flex-col items-center gap-1 py-2 pb-[20px]">
        <div className="flex flex-col items-center gap-1 flex-1 justify-end pt-1">
          {bottomTools.map((item) => (
            <Button
              key={item.id}
              variant={activeView === item.id ? "secondary" : "ghost"}
              size="icon"
              className="h-10 w-10"
              title={item.label}
              onClick={() => onViewChange(item.id)}
            >
              <item.icon
                weight="fill"
                size={24}
                color={activeView === item.id ? "var(--tool-icon-active)" : "var(--tool-icon-inactive)"}
              />
            </Button>
          ))}
        </div>
      </div>
    </nav>
  );
}
