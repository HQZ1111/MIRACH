/**
 * rightTabs — 右侧栏面板定义（主应用与覆盖层弹窗共用）
 *
 * 覆盖层 webview 与主应用是同一前端 bundle，但事件载荷只能传可序列化数据
 * （图标是 React 组件，无法序列化）——因此面板/图标映射放在这里共享。
 */

import type { ElementType } from "react";
import {
  ChatText,
  ChatsCircle,
  Eye,
  Globe,
  MagnifyingGlass,
  TerminalWindow,
} from "@phosphor-icons/react";

export interface PanelItem {
  id: string;
  icon: ElementType;
  label: string;
}

export const PANELS: PanelItem[] = [
  { id: "assistant", icon: ChatText, label: "辅助对话" },
  { id: "projects", icon: ChatsCircle, label: "与其他项目对话" },
  { id: "review", icon: MagnifyingGlass, label: "审查" },
  { id: "preview", icon: Eye, label: "预览" },
  { id: "console", icon: TerminalWindow, label: "控制台" },
  { id: "terminal", icon: TerminalWindow, label: "终端" },
  { id: "browser", icon: Globe, label: "浏览器" },
];

export const PANEL_ICON: Record<string, ElementType> = Object.fromEntries(
  PANELS.map((p) => [p.id, p.icon]),
);

/** 右侧栏标签项 */
export interface TabItem {
  /** 实例唯一 id（同面板可多开：`${panelId}-${n}`） */
  id: string;
  /** 面板类型 id（对应 PANELS 的 id：assistant/projects/…） */
  panelId: string;
  label: string;
}
