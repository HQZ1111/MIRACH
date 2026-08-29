/**
 * plugins - 插件系统 store（S3-5，本地持久化）
 *
 * 插件 = 前端功能扩展（Git/Docker/浏览器自动化…）。列表与启用状态存
 * localStorage（hermes.plugins.v1）；目录（CATALOG）提供可安装项。
 * 主面板标题区的插件图标从这里读取（仅显示已启用插件）。
 */

import { atom } from "nanostores";

export interface PluginMeta {
  id: string;
  label: string;
  desc: string;
  category: string;
}

export interface InstalledPlugin extends PluginMeta {
  enabled: boolean;
}

const STORAGE_KEY = "mirach.plugins.v1";

// 可安装目录（mock；真实插件市场/本地目录扫描接后端后替换）
export const PLUGIN_CATALOG: PluginMeta[] = [
  { id: "git", label: "Git", desc: "仓库状态、分支管理与代码审查", category: "开发" },
  { id: "docker", label: "Docker", desc: "容器构建与日志查看", category: "开发" },
  { id: "k8s", label: "Kubernetes", desc: "集群资源与部署管理", category: "开发" },
  { id: "database", label: "Database", desc: "数据库查询与 schema 浏览", category: "开发" },
  { id: "browser", label: "Browser", desc: "内嵌浏览器与页面自动化", category: "工具" },
  { id: "ssh", label: "Terminal", desc: "终端执行与远程 SSH", category: "工具" },
  { id: "python", label: "Python", desc: "Python 脚本执行环境", category: "语言" },
  { id: "vscode", label: "VSCode", desc: "代码编辑与文件预览", category: "语言" },
  { id: "slack", label: "Slack", desc: "Slack 消息与通知集成", category: "通讯" },
  { id: "figma", label: "Figma", desc: "设计稿标注与导出", category: "设计" },
];

function load(): InstalledPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as InstalledPlugin[];
      if (Array.isArray(arr)) return arr;
    }
  } catch {
    /* 解析失败回退默认 */
  }
  return PLUGIN_CATALOG.map((p) => ({ ...p, enabled: true }));
}

export const $plugins = atom<InstalledPlugin[]>(load());

function persist(list: InstalledPlugin[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 隐私模式忽略 */
  }
}

function commit(list: InstalledPlugin[]): void {
  persist(list);
  $plugins.set(list);
}

/** 启停插件 */
export function togglePlugin(id: string): void {
  commit(
    $plugins.get().map((p) => (p.id === id ? { ...p, enabled: !p.enabled } : p)),
  );
}

/** 安装目录项（已在列表则只启用） */
export function installPlugin(id: string): void {
  const meta = PLUGIN_CATALOG.find((p) => p.id === id);
  if (!meta) return;
  const current = $plugins.get();
  if (current.some((p) => p.id === id)) {
    commit(current.map((p) => (p.id === id ? { ...p, enabled: true } : p)));
  } else {
    commit([{ ...meta, enabled: true }, ...current]);
  }
}

/** 卸载（从列表移除） */
export function uninstallPlugin(id: string): void {
  commit($plugins.get().filter((p) => p.id !== id));
}

/** 已启用插件 id 集（主面板标题区图标读取） */
export function enabledPluginIds(): string[] {
  return $plugins.get().filter((p) => p.enabled).map((p) => p.id);
}
