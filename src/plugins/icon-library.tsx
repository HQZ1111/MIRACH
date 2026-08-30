/**
 * icon-library — 环境图标注册表（通用复用）
 *
 * 数据：lucide-react 精选 36 项（{id, label, keywords, Icon}）。
 * id 形如 "lucide:code"；renderEnvIcon(iconId, className) 查表渲染，
 * 未命中回退默认图标——新增图标后旧数据兼容。
 * 开放 registerIcon()：其他图标包可扩展（插件贡献面）。
 */

import type { LucideIcon } from "lucide-react";
import {
  Code2, TerminalSquare, Briefcase, LineChart, PenLine, MessageCircle, Home, Bot, Globe,
  BookOpen, Star, Coins, CalendarDays, Mail, Scissors, FlaskConical, Palette, Music,
  Camera, Gamepad2, Shield, Database, Cloud, Lightbulb, ListChecks, Settings2, Rocket,
  Sprout, KeyRound, Moon, Sun, Heart, ShoppingCart, FolderOpen, Search, Zap, Building2,
  Cpu, Wrench, GraduationCap,
} from "lucide-react";

export interface IconItem {
  /** 稳定 id："lucide:<name>" */
  id: string;
  /** 展示名（搜索用） */
  label: string;
  /** 搜索关键词 */
  keywords: string[];
  Icon: LucideIcon;
}

export const ICON_ITEMS: IconItem[] = [
  { id: "lucide:code", label: "代码", keywords: ["code", "开发", "编程"], Icon: Code2 },
  { id: "lucide:terminal", label: "终端", keywords: ["terminal", "命令行", "shell"], Icon: TerminalSquare },
  { id: "lucide:briefcase", label: "工作", keywords: ["work", "办公", "商务"], Icon: Briefcase },
  { id: "lucide:chart", label: "金融", keywords: ["chart", "金融", "行情", "量化"], Icon: LineChart },
  { id: "lucide:pen", label: "写作", keywords: ["write", "写作", "文案"], Icon: PenLine },
  { id: "lucide:chat", label: "聊天", keywords: ["chat", "对话", "聊天"], Icon: MessageCircle },
  { id: "lucide:home", label: "主页", keywords: ["home", "主页", "家"], Icon: Home },
  { id: "lucide:bot", label: "机器人", keywords: ["bot", "AI", "助手"], Icon: Bot },
  { id: "lucide:globe", label: "全球", keywords: ["globe", "全球", "网络"], Icon: Globe },
  { id: "lucide:book", label: "知识", keywords: ["book", "知识", "学习"], Icon: BookOpen },
  { id: "lucide:star", label: "收藏", keywords: ["star", "收藏", "星标"], Icon: Star },
  { id: "lucide:coins", label: "投资", keywords: ["coins", "投资", "币"], Icon: Coins },
  { id: "lucide:calendar", label: "日程", keywords: ["calendar", "日程", "日历"], Icon: CalendarDays },
  { id: "lucide:mail", label: "邮件", keywords: ["mail", "邮件"], Icon: Mail },
  { id: "lucide:scissors", label: "剪辑", keywords: ["scissors", "剪辑", "视频"], Icon: Scissors },
  { id: "lucide:flask", label: "实验", keywords: ["flask", "实验", "研究"], Icon: FlaskConical },
  { id: "lucide:palette", label: "设计", keywords: ["palette", "设计", "美术"], Icon: Palette },
  { id: "lucide:music", label: "音乐", keywords: ["music", "音乐"], Icon: Music },
  { id: "lucide:camera", label: "摄影", keywords: ["camera", "摄影", "照片"], Icon: Camera },
  { id: "lucide:game", label: "游戏", keywords: ["game", "游戏"], Icon: Gamepad2 },
  { id: "lucide:shield", label: "安全", keywords: ["shield", "安全", "防护"], Icon: Shield },
  { id: "lucide:database", label: "数据", keywords: ["database", "数据", "库"], Icon: Database },
  { id: "lucide:cloud", label: "云", keywords: ["cloud", "云", "远程"], Icon: Cloud },
  { id: "lucide:bulb", label: "灵感", keywords: ["bulb", "灵感", "创意"], Icon: Lightbulb },
  { id: "lucide:tasks", label: "清单", keywords: ["tasks", "清单", "待办"], Icon: ListChecks },
  { id: "lucide:settings", label: "配置", keywords: ["settings", "配置", "设置"], Icon: Settings2 },
  { id: "lucide:rocket", label: "发布", keywords: ["rocket", "发布", "上线"], Icon: Rocket },
  { id: "lucide:sprout", label: "孵化", keywords: ["sprout", "孵化", "种子"], Icon: Sprout },
  { id: "lucide:key", label: "密钥", keywords: ["key", "密钥", "凭据"], Icon: KeyRound },
  { id: "lucide:moon", label: "夜间", keywords: ["moon", "夜间", "晚"], Icon: Moon },
  { id: "lucide:sun", label: "日间", keywords: ["sun", "日间", "白天"], Icon: Sun },
  { id: "lucide:heart", label: "生活", keywords: ["heart", "生活", "健康"], Icon: Heart },
  { id: "lucide:cart", label: "购物", keywords: ["cart", "购物", "电商"], Icon: ShoppingCart },
  { id: "lucide:folder", label: "项目", keywords: ["folder", "项目", "目录"], Icon: FolderOpen },
  { id: "lucide:search", label: "调研", keywords: ["search", "调研", "搜索"], Icon: Search },
  { id: "lucide:zap", label: "快捷", keywords: ["zap", "快捷", "自动化"], Icon: Zap },
  { id: "lucide:building", label: "企业", keywords: ["building", "企业", "公司"], Icon: Building2 },
  { id: "lucide:cpu", label: "算力", keywords: ["cpu", "算力", "硬件"], Icon: Cpu },
  { id: "lucide:wrench", label: "工具", keywords: ["wrench", "工具", "维修"], Icon: Wrench },
  { id: "lucide:school", label: "教育", keywords: ["school", "教育", "课程"], Icon: GraduationCap },
];

const byId = new Map<string, IconItem>(ICON_ITEMS.map((i) => [i.id, i]));

const registry: IconItem[] = [...ICON_ITEMS];

/** 开放注册：其他图标包可追加（id 冲突时后到者忽略）。 */
export function registerIcon(item: IconItem): void {
  if (byId.has(item.id)) return;
  byId.set(item.id, item);
  registry.push(item);
}

/** 按 id 取图标项（未命中回退：先试去掉前缀的裸名，再回退默认）。 */
export function getIconItem(id: string | undefined): IconItem {
  if (id) {
    const hit = byId.get(id);
    if (hit !== undefined) return hit;
    const bare = byId.get(id.replace(/^lucide:/, ""));
    if (bare !== undefined) return bare;
  }
  return byId.get("lucide:bot")!;
}

/** 按 id 渲染图标组件（未命中回退机器人图标）。 */
export function renderEnvIcon(iconId: string | undefined, className?: string): React.ReactElement {
  const item = getIconItem(iconId);
  const Icon = item.Icon;
  return <Icon className={className} />;
}

/** 搜索：label/keywords 含关键词（大小写不敏感）。 */
export function searchIcons(query: string): IconItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return registry;
  return registry.filter(
    (i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}
