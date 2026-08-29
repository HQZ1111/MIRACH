/**
 * 插件系统骨架 — 注册表 + 贡献点
 *
 * 当前贡献点：顶栏工具下拉菜单（toolMenu）、独立页面路由（viewPage）。
 * 插件通过 registerPlugin() 注册（模块导入即注册），
 * UI 侧用 getToolMenuActions() / getPluginViewPage() 读取并挂载。
 * 后续可扩展贡献点：侧栏导航 / 状态栏 / 命令面板。
 */

import type { ReactNode } from "react";

export type PluginIcon =
  | "git" | "folder" | "log" | "doc" | "star" | "sparkles" | "plugin";

export interface PluginMenuAction {
  id: string;
  label: string;
  icon: PluginIcon;
  run: () => void;
}

export interface PluginViewPage {
  /** 页面路由 id（唯一，如 plugin-hello）；ViewPages 以 view 值匹配 */
  id: string;
  /** 导航 / 按钮显示名 */
  label: string;
  /** 页面渲染函数（惰性：打开时才调用） */
  render: () => ReactNode;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  /** 顶栏工具下拉菜单贡献 */
  toolMenu?: PluginMenuAction[];
  /** 独立页面路由贡献（插件扩展路由） */
  viewPage?: PluginViewPage;
}

const registry: Plugin[] = [];

export function registerPlugin(p: Plugin): void {
  if (registry.some((x) => x.id === p.id)) return;
  registry.push(p);
}

export function getPlugins(): Plugin[] {
  return [...registry];
}

export function getToolMenuActions(): PluginMenuAction[] {
  return registry.flatMap((p) => p.toolMenu ?? []);
}

/** 按路由 id 查插件独立页面（ViewPages 默认分支解析用） */
export function getPluginViewPage(id: string): PluginViewPage | null {
  for (const p of registry) {
    if (p.viewPage && p.viewPage.id === id) return p.viewPage;
  }
  return null;
}

/** 所有带独立页面的插件（PluginsOverlay「扩展页面」分组用） */
export function getPluginViewPages(): { pluginId: string; page: PluginViewPage }[] {
  return registry
    .filter((p) => p.viewPage)
    .map((p) => ({ pluginId: p.id, page: p.viewPage! }));
}
