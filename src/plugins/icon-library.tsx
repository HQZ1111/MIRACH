/**
 * icon-library — 环境图标注册表（通用复用）
 *
 * 数据：@phosphor-icons/react 面性（weight="fill"）精选 40 项——与左工具栏
 * 图标风格一致（左工具栏固定项全部 Phosphor fill）。id 形如 "ph:code"；
 * renderEnvIcon(iconId, opts) 查表渲染，未命中回退默认图标——旧 "lucide:code"
 * 数据按冒号后的裸名兼容解析，升级无需迁移。
 * 开放 registerIcon()：其他图标包可扩展（插件贡献面）。
 */

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import {
  Code,
  TerminalWindow,
  Briefcase,
  ChartLineUp,
  Pen,
  ChatCircle,
  House,
  Robot,
  Globe,
  BookOpen,
  Star,
  Coins,
  CalendarDots,
  EnvelopeSimple,
  Scissors,
  Flask,
  Palette,
  MusicNotes,
  Camera,
  Joystick,
  ShieldCheck,
  Database,
  Cloud,
  Lightbulb,
  ListChecks,
  Gear,
  Rocket,
  Plant,
  Key,
  MoonStars,
  Sun,
  Heart,
  ShoppingCartSimple,
  FolderOpen,
  MagnifyingGlass,
  Lightning,
  Buildings,
  Cpu,
  Wrench,
  GraduationCap,
} from "@phosphor-icons/react";

/** 面性图标组件类型（= Phosphor Icon 组件类型） */
export type EnvIconComponent = PhosphorIcon;

export interface IconItem {
  /** 稳定 id："ph:<bare>" */
  id: string;
  /** 展示名（搜索用） */
  label: string;
  /** 搜索关键词 */
  keywords: string[];
  Icon: EnvIconComponent;
}

export const ICON_ITEMS: IconItem[] = [
  { id: "ph:code", label: "代码", keywords: ["code", "开发", "编程"], Icon: Code },
  { id: "ph:terminal", label: "终端", keywords: ["terminal", "命令行", "shell"], Icon: TerminalWindow },
  { id: "ph:briefcase", label: "工作", keywords: ["work", "办公", "商务"], Icon: Briefcase },
  { id: "ph:chart", label: "金融", keywords: ["chart", "金融", "行情", "量化"], Icon: ChartLineUp },
  { id: "ph:pen", label: "写作", keywords: ["write", "写作", "文案"], Icon: Pen },
  { id: "ph:chat", label: "聊天", keywords: ["chat", "对话", "聊天"], Icon: ChatCircle },
  { id: "ph:home", label: "主页", keywords: ["home", "主页", "家"], Icon: House },
  { id: "ph:bot", label: "机器人", keywords: ["bot", "AI", "助手"], Icon: Robot },
  { id: "ph:globe", label: "全球", keywords: ["globe", "全球", "网络"], Icon: Globe },
  { id: "ph:book", label: "知识", keywords: ["book", "知识", "学习"], Icon: BookOpen },
  { id: "ph:star", label: "收藏", keywords: ["star", "收藏", "星标"], Icon: Star },
  { id: "ph:coins", label: "投资", keywords: ["coins", "投资", "币"], Icon: Coins },
  { id: "ph:calendar", label: "日程", keywords: ["calendar", "日程", "日历"], Icon: CalendarDots },
  { id: "ph:mail", label: "邮件", keywords: ["mail", "邮件"], Icon: EnvelopeSimple },
  { id: "ph:scissors", label: "剪辑", keywords: ["scissors", "剪辑", "视频"], Icon: Scissors },
  { id: "ph:flask", label: "实验", keywords: ["flask", "实验", "研究"], Icon: Flask },
  { id: "ph:palette", label: "设计", keywords: ["palette", "设计", "美术"], Icon: Palette },
  { id: "ph:music", label: "音乐", keywords: ["music", "音乐"], Icon: MusicNotes },
  { id: "ph:camera", label: "摄影", keywords: ["camera", "摄影", "照片"], Icon: Camera },
  { id: "ph:game", label: "游戏", keywords: ["game", "游戏"], Icon: Joystick },
  { id: "ph:shield", label: "安全", keywords: ["shield", "安全", "防护"], Icon: ShieldCheck },
  { id: "ph:database", label: "数据", keywords: ["database", "数据", "库"], Icon: Database },
  { id: "ph:cloud", label: "云", keywords: ["cloud", "云", "远程"], Icon: Cloud },
  { id: "ph:bulb", label: "灵感", keywords: ["bulb", "灵感", "创意"], Icon: Lightbulb },
  { id: "ph:tasks", label: "清单", keywords: ["tasks", "清单", "待办"], Icon: ListChecks },
  { id: "ph:settings", label: "配置", keywords: ["settings", "配置", "设置"], Icon: Gear },
  { id: "ph:rocket", label: "发布", keywords: ["rocket", "发布", "上线"], Icon: Rocket },
  { id: "ph:plant", label: "孵化", keywords: ["plant", "孵化", "种子", "培育"], Icon: Plant },
  { id: "ph:key", label: "密钥", keywords: ["key", "密钥", "凭据"], Icon: Key },
  { id: "ph:moon", label: "夜间", keywords: ["moon", "夜间", "晚"], Icon: MoonStars },
  { id: "ph:sun", label: "日间", keywords: ["sun", "日间", "白天"], Icon: Sun },
  { id: "ph:heart", label: "生活", keywords: ["heart", "生活", "健康"], Icon: Heart },
  { id: "ph:cart", label: "购物", keywords: ["cart", "购物", "电商"], Icon: ShoppingCartSimple },
  { id: "ph:folder", label: "项目", keywords: ["folder", "项目", "目录"], Icon: FolderOpen },
  { id: "ph:search", label: "调研", keywords: ["search", "调研", "搜索"], Icon: MagnifyingGlass },
  { id: "ph:zap", label: "快捷", keywords: ["zap", "快捷", "自动化"], Icon: Lightning },
  { id: "ph:building", label: "企业", keywords: ["building", "企业", "公司"], Icon: Buildings },
  { id: "ph:cpu", label: "算力", keywords: ["cpu", "算力", "硬件"], Icon: Cpu },
  { id: "ph:wrench", label: "工具", keywords: ["wrench", "工具", "维修"], Icon: Wrench },
  { id: "ph:school", label: "教育", keywords: ["school", "教育", "课程"], Icon: GraduationCap },
];

/** id → 项：同时按全 id（"ph:code"）与裸名（"code"）双键，旧前缀数据免费兼容 */
const byId = new Map<string, IconItem>();
for (const item of ICON_ITEMS) {
  byId.set(item.id, item);
  byId.set(bareOf(item.id), item);
}

const registry: IconItem[] = [...ICON_ITEMS];

/** 取冒号后的裸名（"lucide:code" / "ph:code" / "code" → "code"） */
function bareOf(id: string): string {
  const i = id.indexOf(":");
  return i >= 0 ? id.slice(i + 1) : id;
}

/** 开放注册：其他图标包可追加（id 冲突时后到者忽略）。 */
export function registerIcon(item: IconItem): void {
  if (byId.has(item.id) || byId.has(bareOf(item.id))) return;
  byId.set(item.id, item);
  byId.set(bareOf(item.id), item);
  registry.push(item);
}

/** 按 id 取图标项（未命中回退：先试去前缀裸名，再回退默认机器人）。 */
export function getIconItem(id: string | undefined): IconItem {
  if (id) {
    const bare = bareOf(id.trim());
    const hit = byId.get(bare);
    if (hit !== undefined) return hit;
  }
  return byId.get("bot")!;
}

export interface EnvIconProps {
  className?: string;
  size?: number | string;
  color?: string;
}

/** 按 id 渲染面性图标（未命中回退机器人图标）。 */
export function renderEnvIcon(iconId: string | undefined, opts?: EnvIconProps): React.ReactElement {
  const { className, size, color } = opts ?? {};
  const Icon = getIconItem(iconId).Icon;
  return <Icon className={className} size={size} color={color} weight="fill" />;
}

/** 搜索：label/keywords 含关键词（大小写不敏感）。 */
export function searchIcons(query: string): IconItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return registry;
  return registry.filter(
    (i) => i.label.toLowerCase().includes(q) || i.keywords.some((k) => k.toLowerCase().includes(q)),
  );
}
