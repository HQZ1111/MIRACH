/**
 * agents — 智能体（团队成员）store
 *
 * 从 LeftSidebar 的 mockConversations 数据源化：可添加 / 修改 / 删除，
 * 本地持久化（hermes.agents.v1）。ConvItem 类型由本 store 提供，
 * LeftSidebar / MemberChatPanel 从这引用（避免定义散落）。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";
import { $environments } from "@/store/environments";

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
  /** 酒馆预设 id（来源为酒馆预设时携带）：成员会话空白期绑定它，
   *  点亮引擎侧酒馆功能（世界书智能注入/记忆总结/关系网/剧情选项） */
  tavernPresetId?: string;
  /** 头像形状（hermes avatar 词汇：circle/blob/squircle/pill/triangle/
   *  hexagon/cloud/drop/多面体/sigil-N）；缺省按名字派生 */
  avatarShape?: string;
  /** 头像照片（data URL，上传时压缩到 256px） */
  avatarImage?: string;
  /** 环境主人格（每环境一个；主环境团队聚合它的跨环境成员行） */
  primary?: boolean;
  /** 聚合名册的临时标记：该行来自哪个环境（主环境团队视图；不持久化） */
  fromEnv?: string;
}

const STORAGE_KEY = "mirach.agents.v1";

const AVATAR_COLORS = ["#6366F1", "#F59E0B", "#10B981", "#EF4444", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];

/** 主聊天默认成员（Mirach chat）：其 systemPrompt 作为第一个聊天的 persona */
export const DEFAULT_TEAM_ID = "team-kui";

// ---- 环境分片：成员按环境隔离（聊天环境的团队 ≠ 代码/写作环境的团队） ----
let currentAgentsEnv = "main";

/** 当前成员分片所属环境 id（starmap 适配层等只读消费） */
export function agentsEnv(): string {
  return currentAgentsEnv;
}

const agentsEnvKey = (env: string) => `${STORAGE_KEY}.${env}`;

// 团队种子（聊天环境专属）：参考 dsh-collaboration 的专家名单（主代理/规划师/
// 工程师/调试员/审查员/研究员/评论家/写手）本地化——职责与工具分级照社区约定，
// persona 按各自职责用中文撰写。观察员/画家需视觉模型，暂不列入。
const TEAM_SEED_CHAT: ConvItem[] = [
  {
    id: "team-kui", name: "Mirach chat", initials: "M", avatarBg: "#6366F1",
    preview: "全能助理就绪，直接输入任务开始", desc: "主人格 · 主代理 · 统筹分派 · 整合结果", time: "刚刚", status: "generating", tab: "read",
    primary: true,
    avatarShape: "squircle",
    systemPrompt:
      "你是 Mirach chat（Mirach 聊天环境主人格），一位全能个人助理。你统筹全局：复杂任务拆解并交给合适的团队成员，自己直接处理日常对话与轻量任务。" +
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

/** 某环境的团队种子：每个环境都带一个主人格（primary）——名字跟随环境名
 *  （Mirach / Mirach chat/code/work/finance/write），聊天环境是 Mirach chat
 *  （完整团队）。主环境团队视图聚合全部环境的主人格。 */
const ENV_PRIMARY_SEEDS: Record<string, ConvItem> = {
  main: {
    id: "primary-main", name: "Mirach", initials: "M", avatarBg: "#026CFE",
    preview: "六环境统筹就绪", desc: "主人格 · 统筹全部环境的领域总管", time: "刚刚", status: "generating", tab: "read",
    primary: true,
    avatarShape: "squircle",
    systemPrompt:
      "你是 Mirach（主环境主人格），统筹六个环境（聊天/代码/工作/金融/写作）的领域总管。" +
      "你了解每个环境的职责边界，负责跨环境任务的拆解、指派与结果整合；自己直接处理全局性对话。" +
      "回答用简体中文；结论前置；涉及具体环境任务时建议转给对应环境总管。",
    model: "deepseek-v4-flash-0731",
    tools: ["bash", "文件", "搜索", "网络", "代码"],
  },
  code: {
    id: "primary-code", name: "Mirach code", initials: "M", avatarBg: "#10B981",
    preview: "代码环境统筹就绪", desc: "主人格 · 代码环境 · 工程实现统筹", time: "刚刚", status: "pending", tab: "read",
    primary: true,
    avatarShape: "hexagon",
    systemPrompt:
      "你是 Mirach code（代码环境主人格），统筹代码环境的全部工程任务：需求分析、方案设计、" +
      "实现与调试的拆解分派，自己直接处理轻量编码问题。工作区即代码环境工作区；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["bash", "文件", "搜索", "代码"],
  },
  work: {
    id: "primary-work", name: "Mirach work", initials: "M", avatarBg: "#F59E0B",
    preview: "工作环境统筹就绪", desc: "主人格 · 工作环境 · 任务与文档统筹", time: "刚刚", status: "pending", tab: "read",
    primary: true,
    avatarShape: "squircle",
    systemPrompt:
      "你是 Mirach work（工作环境主人格），统筹工作环境的任务管理、日程安排与文档处理，" +
      "自己直接处理轻量整理类任务。工作区即工作环境工作区；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索"],
  },
  finance: {
    id: "primary-finance", name: "Mirach finance", initials: "M", avatarBg: "#EF4444",
    preview: "金融环境统筹就绪", desc: "主人格 · 金融环境 · 数据与市场统筹", time: "刚刚", status: "pending", tab: "read",
    primary: true,
    avatarShape: "drop",
    systemPrompt:
      "你是 Mirach finance（金融环境主人格），统筹金融环境的数据分析、风险评估与市场研究任务，" +
      "自己直接处理轻量查询。输出附数据出处，不做投资建议承诺；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件", "搜索", "网络"],
  },
  write: {
    id: "primary-write", name: "Mirach write", initials: "M", avatarBg: "#8B5CF6",
    preview: "写作环境统筹就绪", desc: "主人格 · 写作环境 · 文案与内容统筹", time: "刚刚", status: "pending", tab: "read",
    primary: true,
    avatarShape: "pill",
    systemPrompt:
      "你是 Mirach write（写作环境主人格），统筹写作环境的文案创作、内容优化与多语翻译任务，" +
      "自己直接处理轻量润色。写作原则：结构清晰、结论前置、示例优先；用简体中文。",
    model: "deepseek-v4-flash-0731",
    tools: ["文件"],
  },
};

/** 某环境的团队种子：环境主人格 + （聊天环境的）完整专家团队 */
function teamSeedFor(env: string): ConvItem[] {
  const primary = ENV_PRIMARY_SEEDS[env];
  if (env === "chat") {
    // Mirach chat 即聊天环境主人格（种子内已标 primary）
    return TEAM_SEED_CHAT;
  }
  return primary ? [primary] : [];
}

/** 指定环境的主人格（无显式标记时回落第一个成员） */
export function primaryAgentOf(envId: string): ConvItem | null {
  const list = loadAgentsOf(envId);
  return list.find((a) => a.primary) ?? list[0] ?? null;
}

/**
 * 环境团队名册：主环境 = 本环境成员 ⊕ 其他每个环境的主人格（跨环境成员行，
 * 带 fromEnv 标记与唯一 id）；其他环境返回自己的成员。跨环境行不持久化，
 * 每次从各环境分片现取（hermes roster 的多来源模式）。
 */
export function teamRosterFor(envId: string): ConvItem[] {
  const own = loadAgentsOf(envId);
  if (envId !== "main") return own;
  const cross = $environments
    .get()
    .filter((e) => e.id !== "main" && e.visible !== false)
    .map((e): ConvItem | null => {
      const primary = loadAgentsOf(e.id).find((a) => a.primary);
      if (!primary) return null;
      return { ...primary, id: `fromEnv:${e.id}`, fromEnv: e.id };
    })
    .filter((a): a is ConvItem => a !== null);
  return [...own, ...cross];
}

/** 存量主人格改名迁移：旧种子名 → 跟随环境名（Mirach chat/code/work/…）。
 *  只精确匹配旧种子名的主人格行才改，用户自定义名不动；读时迁移、幂等。 */
const PRIMARY_NAME_MIGRATIONS: Record<string, string> = {
  "奎木狼": "Mirach chat",
  "代码总管": "Mirach code",
  "工作总管": "Mirach work",
  "金融总管": "Mirach finance",
  "写作总管": "Mirach write",
};

/** 读取指定环境的成员分片（不切换当前分片——设置页环境标签用） */
export function loadAgentsOf(envId: string): ConvItem[] {
  const key = agentsEnvKey(envId);
  const seed = teamSeedFor(envId);
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw) as ConvItem[];
      if (Array.isArray(arr)) {
        // 演示种子清洗（真实模式）：id 1~6 是早期硬编码队友。
        // 存储列表为权威（早期的"缺谁补谁"种子并入已退役）——
        // 否则删掉的种子成员会在下次 load 时复活。
        return arr
          .filter((a) => MOCK || !/^[1-6]$/.test(a.id))
          .map((a) => {
            const newName = a.primary ? PRIMARY_NAME_MIGRATIONS[a.name] : undefined;
            if (!newName) return a;
            return {
              ...a,
              name: newName,
              initials: "M",
              // 人设文本里的自称同步（"你是奎木狼（…）" → "你是 Mirach chat（…）"）
              systemPrompt: a.systemPrompt?.replace(/^你是[^，。;；]*?（/, `你是 ${newName}（`),
            };
          });
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

/** 成员分片写入版本号：任意环境的写入都 bump——主环境聚合的跨环境主人格行
 *  （读其他环境分片）不经过 $agents，侧栏/设置页订阅本版本号获得刷新信号。 */
export const $agentsVersion = atom<number>(0);

let idSeq = 0;

function buildAgent(
  input: {
    name: string;
    desc?: string;
    avatarBg?: string;
    avatarShape?: string;
    avatarImage?: string;
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
    avatarShape: input.avatarShape || undefined,
    avatarImage: input.avatarImage || undefined,
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
  $agentsVersion.set($agentsVersion.get() + 1);
  if (envId === currentAgentsEnv) $agents.set(list);
}

/** 新增智能体到指定环境（设置页环境标签用；当前环境走 addAgent） */
export function addAgentIn(
  envId: string,
  input: {
    name: string;
    desc?: string;
    avatarBg?: string;
    avatarShape?: string;
    avatarImage?: string;
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
  avatarShape?: string;
  avatarImage?: string;
  tab?: ConvItem["tab"];
  systemPrompt?: string;
  model?: string;
  tools?: string[];
}): ConvItem {
  return addAgentIn(currentAgentsEnv, input);
}

/** 修改指定环境的智能体（name/desc/avatar 三件套/status/tab/systemPrompt/model/tools/source） */
export function updateAgentIn(
  envId: string,
  id: string,
  patch: Partial<Pick<ConvItem, "name" | "desc" | "avatarBg" | "avatarShape" | "avatarImage" | "status" | "tab" | "preview" | "systemPrompt" | "model" | "tools" | "source">>,
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
  patch: Partial<Pick<ConvItem, "name" | "desc" | "avatarBg" | "avatarShape" | "avatarImage" | "status" | "tab" | "preview" | "systemPrompt" | "model" | "tools" | "source">>,
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
  /** 酒馆预设 id（来源为酒馆预设时携带；成员会话空白期绑定） */
  presetId?: string;
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
        ? {
            ...a,
            name: input.name,
            systemPrompt: input.systemPrompt,
            desc: input.desc ?? a.desc,
            source: "tavern" as const,
            tavernPresetId: input.presetId,
          }
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
        tavernPresetId: input.presetId,
      },
    ];
  }
  saveAgentsOf(TAVERN_MEMBER_ENV, next);
  return next.find((a) => a.id === id)!;
}
