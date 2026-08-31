/**
 * agents — 智能体（团队成员）store
 *
 * 从 LeftSidebar 的 mockConversations 数据源化：可添加 / 修改 / 删除，
 * 本地持久化（hermes.agents.v1）。ConvItem 类型由本 store 提供，
 * LeftSidebar / MemberChatPanel 从这引用（避免定义散落）。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";

export type AgentStatus = "generating" | "completed" | "pending";

export interface ConvItem {
  id: string;
  name: string;
  initials: string;
  avatarBg: string;
  preview: string;
  desc: string;
  time: string;
  status: AgentStatus;
  tab: "all" | "read" | "unread";
  /** 系统提示词（persona，参考 dsh agent preset） */
  systemPrompt?: string;
  /** 使用的模型 id */
  model?: string;
  /** 可用工具清单（bash/文件/搜索/浏览器/网络/代码） */
  tools?: string[];
  /** 来源（"tavern" = 酒馆角色卡/预设导入；缺省 = mirach 原生成员） */
  source?: "tavern";
}

const STORAGE_KEY = "mirach.agents.v1";

const AVATAR_COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];

/** 主聊天默认成员（奎木狼）：其 systemPrompt 作为第一个聊天的 persona */
export const DEFAULT_TEAM_ID = "team-kui";

// ---- 环境分片：成员按环境隔离（聊天环境的团队 ≠ 代码/写作环境的团队） ----
let currentAgentsEnv = "main";
const agentsEnvKey = (env: string) => `${STORAGE_KEY}.${env}`;

// 团队种子（聊天环境专属）：参考 dsh-collaboration 的专家名单（主代理/规划师/
// 工程师/调试员/审查员/研究员/评论家/写手）本地化——职责与工具分级照社区约定，
// persona 按各自职责用中文撰写。观察员/画家需视觉模型，暂不列入。
const TEAM_SEED_CHAT: ConvItem[] = [
  {
    id: "team-kui", name: "奎木狼", initials: "奎", avatarBg: "#6366F1",
    preview: "全能助理就绪，直接输入任务开始", desc: "主代理 · 统筹分派 · 整合结果", time: "刚刚", status: "generating", tab: "read",
    systemPrompt:
      "你是奎木狼（Mirach 主代理），一位全能个人助理。你统筹全局：复杂任务拆解并交给合适的团队成员，自己直接处理日常对话与轻量任务。" +
      "回答用简体中文；先给结论再给细节；不确定时明确说不确定，绝不编造。",
    model: "deepseek-v4-flash-0731",
    tools: ["bash", "文件", "搜索", "网络", "代码"],
  },
  {
    id: "team-planner", name: "规划师", initials: "规", avatarBg: "#F59E0B",
    preview: "目标拆解与步骤规划就绪", desc: "规划师 · 目标拆解为有序步骤", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是规划师（Mirach 团队），负责把模糊目标拆解为有序、带依赖关系的执行步骤。" +
      "输出：步骤清单（每步有产出物与依赖标注）、风险与前置条件。只规划不执行；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索"],
  },
  {
    id: "team-coder", name: "工程师", initials: "工", avatarBg: "#10B981",
    preview: "生产级代码实现就绪", desc: "工程师 · 按项目规范写生产代码", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是工程师（Mirach 团队），负责编写符合项目既有规范的生产级代码。" +
      "先读相关文件再动手；给出完整可运行的实现并标注关键点；改动最小化、不顺手重构；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["bash", "文件", "代码"],
  },
  {
    id: "team-debugger", name: "调试员", initials: "调", avatarBg: "#EF4444",
    preview: "缺陷复现与修复方案就绪", desc: "调试员 · 复现缺陷并起草修复", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是调试员（Mirach 团队），负责复现缺陷并起草修复方案。" +
      "流程：先复现（最小化步骤/脚本）→ 定位根因（给证据）→ 修复方案与回归风险。不凭猜测下结论；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["bash", "文件", "代码"],
  },
  {
    id: "team-reviewer", name: "审查员", initials: "审", avatarBg: "#8B5CF6",
    preview: "安全与边界审查就绪", desc: "审查员 · 安全/边界/性能审查", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是审查员（Mirach 团队），负责安全、边界条件与性能三方面的审查。" +
      "输出：问题清单（按严重度排序，每条给位置、影响、建议修法）。只审查不改代码；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索"],
  },
  {
    id: "team-researcher", name: "研究员", initials: "研", avatarBg: "#06B6D4",
    preview: "技术与竞品调研就绪", desc: "研究员 · 技术/竞品调研（带出处）", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是研究员（Mirach 团队），负责技术方案与竞品调研。" +
      "输出：对比矩阵 + 结论 + **每条信息附出处链接**；查不到的明确标注缺失。用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索", "网络"],
  },
  {
    id: "team-critic", name: "评论家", initials: "评", avatarBg: "#EC4899",
    preview: "假设挑战与反方观点就绪", desc: "评论家 · 挑战假设的反方视角", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是评论家（Mirach 团队），专门挑战方案里的隐含假设与乐观估计。" +
      "输出：最强反方观点（每条说明在什么条件下原方案会失败）+ 缓解建议。对事不对人；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索"],
  },
  {
    id: "team-writer", name: "写手", initials: "写", avatarBg: "#F97316",
    preview: "文档与报告写作就绪", desc: "写手 · 文档/报告/README", time: "刚刚", status: "pending", tab: "read",
    systemPrompt:
      "你是写手（Mirach 团队），负责 README、接口文档、变更说明与报告。" +
      "写作原则：结构清晰、结论前置、示例优先、不堆砌废话；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件"],
  },
];

/** 某环境的团队种子（只有聊天环境带完整团队；其他环境从空开始） */
function teamSeedFor(env: string): ConvItem[] {
  return env === "chat" ? TEAM_SEED_CHAT : [];
}

/** 读取指定环境的成员分片（不切换当前分片——设置页环境标签用） */
export function loadAgentsOf(envId: string): ConvItem[] {
  const key = agentsEnvKey(envId);
  const seed = teamSeedFor(envId);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw) as ConvItem[];
      if (Array.isArray(arr)) {
        // 演示种子清洗（真实模式）：id 1~6 是早期硬编码队友
        const cleaned = MOCK ? arr : arr.filter((a) => !/^[1-6]$/.test(a.id));
        // 团队种子并入：已存列表缺的成员补上（用户版本优先）
        const ids = new Set(cleaned.map((a) => a.id));
        return [...cleaned, ...(MOCK ? [] : seed.filter((s) => !ids.has(s.id)))];
      }
    }
  } catch {
    /* 解析失败回退种子 */
  }
  return seed;
}

function load(): ConvItem[] {
  return loadAgentsOf(currentAgentsEnv);
}

/** 环境切换：成员列表随之切换到对应环境的分片（MainPanel 流水线调用） */
export function setAgentsEnv(envId: string): void {
  if (envId === currentAgentsEnv) return;
  currentAgentsEnv = envId;
  $agents.set(load());
}

export const $agents = atom<ConvItem[]>(load());

let idSeq = 0;

function buildAgent(
  input: {
    name: string;
    desc?: string;
    avatarBg?: string;
    tab?: ConvItem["tab"];
    systemPrompt?: string;
    model?: string;
    tools?: string[];
  },
  list: ConvItem[],
): ConvItem {
  const name = input.name.trim();
  return {
    id: `a${Date.now()}_${idSeq++}`,
    name,
    initials: name.slice(0, 2).toUpperCase(),
    avatarBg: input.avatarBg ?? AVATAR_COLORS[list.length % AVATAR_COLORS.length],
    preview: "（新智能体，等待分配任务）",
    desc: input.desc?.trim() || "智能体 · 待配置职责",
    time: "刚刚",
    status: "pending",
    tab: input.tab ?? "all",
    systemPrompt: input.systemPrompt?.trim() || undefined,
    model: input.model || undefined,
    tools: input.tools?.length ? input.tools : undefined,
  };
}

/** 写入指定环境的成员分片；写当前分片时同步 $agents（左栏/对话区实时刷新） */
export function saveAgentsOf(envId: string, list: ConvItem[]): void {
  try {
    localStorage.setItem(agentsEnvKey(envId), JSON.stringify(list));
  } catch {
    /* 存储失败忽略 */
  }
  if (envId === currentAgentsEnv) $agents.set(list);
}

/** 新增智能体到指定环境（设置页环境标签用；当前环境走 addAgent） */
export function addAgentIn(
  envId: string,
  input: {
    name: string;
    desc?: string;
    avatarBg?: string;
    tab?: ConvItem["tab"];
    systemPrompt?: string;
    model?: string;
    tools?: string[];
  },
): ConvItem {
  const list = loadAgentsOf(envId);
  const agent = buildAgent(input, list);
  saveAgentsOf(envId, [...list, agent]);
  return agent;
}

/** 新增智能体（名称必填；可带系统提示词/模型/工具）——写当前激活环境分片 */
export function addAgent(input: {
  name: string;
  desc?: string;
  avatarBg?: string;
  tab?: ConvItem["tab"];
  systemPrompt?: string;
  model?: string;
  tools?: string[];
}): ConvItem {
  return addAgentIn(currentAgentsEnv, input);
}

/** 修改指定环境的智能体（name/desc/avatarBg/status/tab/systemPrompt/model/tools/source） */
export function updateAgentIn(
  envId: string,
  id: string,
  patch: Partial<Pick<ConvItem, "name" | "desc" | "avatarBg" | "status" | "tab" | "preview" | "systemPrompt" | "model" | "tools" | "source">>,
): void {
  saveAgentsOf(
    envId,
    loadAgentsOf(envId).map((a) => {
      if (a.id !== id) return a;
      const next = { ...a, ...patch };
      if (patch.name?.trim()) {
        next.name = patch.name.trim();
        next.initials = next.name.slice(0, 2).toUpperCase();
      }
      return next;
    }),
  );
}

/** 修改智能体——写当前激活环境分片 */
export function updateAgent(
  id: string,
  patch: Partial<Pick<ConvItem, "name" | "desc" | "avatarBg" | "status" | "tab" | "preview" | "systemPrompt" | "model" | "tools" | "source">>,
): void {
  updateAgentIn(currentAgentsEnv, id, patch);
}

/** 删除指定环境的智能体 */
export function removeAgentIn(envId: string, id: string): boolean {
  const before = loadAgentsOf(envId);
  const after = before.filter((a) => a.id !== id);
  saveAgentsOf(envId, after);
  return after.length < before.length;
}

/** 删除智能体——写当前激活环境分片 */
export function removeAgent(id: string): boolean {
  return removeAgentIn(currentAgentsEnv, id);
}

// ---- 酒馆角色导入（dsh-tavern → 成员；同 key 幂等 upsert） ----

export interface TavernMemberInput {
  /** 稳定键（预设目录名 / 角色卡 name）→ 成员 id = tavern-<key>，重导不重复 */
  key: string;
  name: string;
  systemPrompt: string;
  desc?: string;
}

/** 酒馆成员固定归属：聊天环境（用户约定——酒馆角色只放聊天环境） */
export const TAVERN_MEMBER_ENV = "chat";

/** 导入/更新一个酒馆角色成员（固定写入聊天环境；按 key 幂等，重导只更新人设） */
export function upsertTavernMember(input: TavernMemberInput): ConvItem {
  const id = `tavern-${input.key}`;
  const list = loadAgentsOf(TAVERN_MEMBER_ENV);
  const existing = list.find((a) => a.id === id);
  let next: ConvItem[];
  if (existing) {
    next = list.map((a) =>
      a.id === id
        ? { ...a, name: input.name, systemPrompt: input.systemPrompt, desc: input.desc ?? a.desc, source: "tavern" as const }
        : a,
    );
  } else {
    next = [
      ...list,
      {
        id,
        name: input.name,
        initials: input.name.slice(0, 2).toUpperCase(),
        avatarBg: AVATAR_COLORS[(list.length + 3) % AVATAR_COLORS.length],
        preview: "酒馆角色就绪，直接开始对话",
        desc: input.desc?.trim() || "酒馆角色 · 角色扮演",
        time: "刚刚",
        status: "pending" as const,
        tab: "all" as const,
        systemPrompt: input.systemPrompt,
        source: "tavern" as const,
      },
    ];
  }
  saveAgentsOf(TAVERN_MEMBER_ENV, next);
  return next.find((a) => a.id === id)!;
}
