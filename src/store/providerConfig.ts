/**
 * providerConfig — 推理提供商完整配置（登录页首次引导与设置页「模型」区共享的单一数据源）
 *
 * 与 store/providers.ts（只存掩码提示 + 连接状态）不同，这里存完整配置：
 * providerId / baseURL / 协议 / 模型列表 / API key（明文，用户已确认存 localStorage）。
 * 登录页 ProviderConnectPanel「保存」与设置页 Model 区「应用」都读写本 store，
 * 保证两边看到的模型配置一致；主界面调 AI 的模型也由此驱动。
 *
 * localStorage key：hermes.providerConfig.v1
 * 迁移：载入时把旧的 hermes.providerProfiles.v1（baseURL/协议/模型）合并进来。
 */

import { atom } from "nanostores";

/** 一个推理等级（dsh ModelReasoningEffort 对齐：引擎可随模型目录下发，缺省走本地默认词表） */
export interface ModelReasoningEffort {
  id: string;
  name: string;
  description?: string;
}

/** 模型推理元数据（与 dsh model.reasoning 对齐：efforts + defaultEffort） */
export interface ModelReasoning {
  efforts: ModelReasoningEffort[];
  defaultEffort?: string;
}

/** 模型行（与 ProviderConnectPanel 的 ModelRow 同构） */
export interface ModelRow {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  /** 推理等级元数据：引擎 discoverModels 下发时带上；缺省前端用默认词表 */
  reasoning?: ModelReasoning;
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: "builtin" | "custom";
  /** 已连接（有 key 且测试/保存成功过） */
  connected: boolean;
  baseURL: string;
  /** wire protocol：openai-completions | openai-responses | anthropic-messages */
  protocol: string;
  /** API key 明文（用户选择落盘；预览/mock 下可为空串） */
  apiKey: string;
  /** 掩码提示（存不了明文时展示用） */
  keyHint?: string;
  models: ModelRow[];
  /** 当前使用模型 id（设置页「模型」区选中项；缺省取 models[0]） */
  activeModelId?: string;
  /** 当前推理等级 id（undefined = 跟随模型默认；dsh ModelSelection.reasoningEffort 对齐） */
  activeEffort?: string;
}

const KEY = "mirach.providerConfig.v1";
const LEGACY_PROFILES_KEY = "mirach.providerProfiles.v1";

const PROVIDER_DEFAULTS: Record<string, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  deepseek: "DeepSeek",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  xai: "xAI",
};

/** 内置提供商列表（来自 providers.ts，避免循环依赖：这里只取 id/name） */
const BUILTIN_IDS = Object.keys(PROVIDER_DEFAULTS);

interface LegacyProfile {
  baseURL?: string;
  api?: string;
  models?: ModelRow[];
}

/** 读旧版 providerProfiles（baseURL/协议/模型，无 key）用于迁移 */
function readLegacyProfiles(): Record<string, LegacyProfile> {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_PROFILES_KEY) ?? "{}") as Record<string, LegacyProfile>;
  } catch {
    return {};
  }
}

/** 读旧版 providerKeys（掩码提示），仅取 keyHint */
function readLegacyKeyHints(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("mirach.providerKeys.v1") ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

function load(): ProviderConfig[] {
  let saved: Record<string, ProviderConfig> = {};
  try {
    saved = JSON.parse(JSON.stringify(localStorage.getItem(KEY) ? JSON.parse(localStorage.getItem(KEY) as string) : {})) as Record<string, ProviderConfig>;
  } catch {
    /* 解析失败从零开始 */
  }
  // 历史脏数据清洗：AddCustomProviderForm 曾把 baseURL 写进 apiKey（leveldb 实证
  // apiKey="https://..."）。URL 不是合法 key——清掉让用户重新填，别再用脏值探测。
  for (const c of Object.values(saved)) {
    if (c.apiKey && /^https?:\/\//i.test(c.apiKey)) {
      c.apiKey = "";
      c.connected = false;
    }
  }
  // 合并旧 profiles（baseURL/协议/模型）+ keyHints，避免用户历史配置丢失
  const legacy = readLegacyProfiles();
  const hints = readLegacyKeyHints();
  const merged = new Map<string, ProviderConfig>(Object.entries(saved));
  for (const id of Object.keys(legacy)) {
    const p = legacy[id];
    const existing = merged.get(id);
    merged.set(id, {
      id,
      name: existing?.name ?? PROVIDER_DEFAULTS[id] ?? id,
      kind: existing?.kind ?? (BUILTIN_IDS.includes(id) ? "builtin" : "custom"),
      connected: existing?.connected ?? Boolean(hints[id]),
      baseURL: existing?.baseURL ?? p?.baseURL ?? "",
      protocol: existing?.protocol ?? p?.api ?? "openai-completions",
      apiKey: existing?.apiKey ?? "",
      keyHint: existing?.keyHint ?? hints[id],
      models: existing?.models ?? p?.models ?? [],
      activeModelId: existing?.activeModelId ?? p?.models?.[0]?.id,
    });
  }
  return Array.from(merged.values());
}

function persist(list: ProviderConfig[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(Object.fromEntries(list.map((c) => [c.id, c]))),
    );
  } catch {
    /* 存储失败忽略 */
  }
}

export const $providerConfig = atom<ProviderConfig[]>(load());

function commit(list: ProviderConfig[]): void {
  persist(list);
  $providerConfig.set(list);
}

export function getProviderConfig(id: string): ProviderConfig | undefined {
  return $providerConfig.get().find((c) => c.id === id);
}

/** 当前有效模型 id：优先 activeModelId，缺省 models[0]，都没有返回空 */
export function activeModelIdOf(cfg: ProviderConfig | undefined): string {
  if (!cfg) return "";
  if (cfg.activeModelId) return cfg.activeModelId;
  return cfg.models[0]?.id ?? "";
}

/** 当前有效推理等级 id：优先 activeEffort，缺省模型 reasoning.defaultEffort（dsh effectiveEffort 对齐） */
export function effectiveEffortOf(cfg: ProviderConfig | undefined): string | undefined {
  if (!cfg) return undefined;
  if (cfg.activeEffort) return cfg.activeEffort;
  const m = cfg.models.find((x) => x.id === activeModelIdOf(cfg));
  return m?.reasoning?.defaultEffort;
}

/** 模型可选的推理等级列表（含"跟随默认"项）：引擎下发 efforts 用之，缺省本地词表 低/中/高 */
export function effortChoicesOf(cfg: ProviderConfig | undefined): { id: string | undefined; name: string }[] {
  const m = cfg?.models.find((x) => x.id === activeModelIdOf(cfg));
  const efforts = m?.reasoning?.efforts;
  const list: { id: string | undefined; name: string }[] = [];
  if (m?.reasoning) {
    // 引擎下发了元数据：跟随默认仅在无 defaultEffort 时提供（dsh 同规则）
    if (m.reasoning.defaultEffort === undefined) {
      list.push({ id: undefined, name: "跟随默认" });
    }
    for (const e of efforts ?? []) list.push({ id: e.id, name: e.name });
    return list;
  }
  // 无元数据：固定词表，跟随默认 = 不携带 effort
  return [
    { id: undefined, name: "跟随默认" },
    { id: "low", name: "低" },
    { id: "medium", name: "中" },
    { id: "high", name: "高" },
  ];
}

/** 当前推理等级显示名（apply 区触发器：model · effort；dsh triggerLabel 对齐） */
export function effortLabelOf(cfg: ProviderConfig | undefined): string {
  const cur = effectiveEffortOf(cfg);
  if (!cur) return "跟随默认";
  const m = cfg?.models.find((x) => x.id === activeModelIdOf(cfg));
  return m?.reasoning?.efforts.find((e) => e.id === cur)?.name ?? cur;
}

/** 全量保存或更新一个提供商的完整配置（登录页保存 / 设置页应用共用） */
export function saveProviderConfig(cfg: ProviderConfig): void {
  const list = $providerConfig.get();
  const idx = list.findIndex((c) => c.id === cfg.id);
  const next = idx >= 0 ? list.map((c, i) => (i === idx ? cfg : c)) : [...list, cfg];
  commit(next);
}

/** 整体替换配置列表（引擎迁移用：从 dsh 读回后写回统一配置源） */
export function replaceProviderConfigs(list: ProviderConfig[]): void {
  commit(list);
}

/** 更新已连接状态（connectProvider 成功后调用，让设置页立即可见） */
export function setProviderConnected(id: string, connected: boolean, keyHint?: string): void {
  commit(
    $providerConfig.get().map((c) =>
      c.id === id ? { ...c, connected, keyHint: keyHint ?? c.keyHint } : c,
    ),
  );
}

/** 删除提供商配置（设置页「已设置模型」卡片的删除按钮；同步清 providers store 连接态） */
export function removeProviderConfig(id: string): void {
  commit($providerConfig.get().filter((c) => c.id !== id));
}

/** 设置页「模型」区：切换当前使用模型 + 推理等级（dsh ModelSelect.select 对齐） */
export function setActiveModel(id: string, modelId: string, effort?: string): void {
  commit(
    $providerConfig.get().map((c) =>
      c.id === id ? { ...c, activeModelId: modelId, activeEffort: effort } : c,
    ),
  );
}

/**
 * 推理强度单一真相源写入口（设置页与 Composer 滑块共用）。
 * 只改当前活跃 provider 的 activeEffort；缺省 providerId 时落到第一个
 * 有 active 模型的配置上（与发送路径取配置的规则一致）。主动选择过
 * effort 后写值；传 undefined 表示清除覆盖、回到模型默认档。
 */
export function setActiveEffort(effort: string, providerId?: string): void {
  const configs = $providerConfig.get();
  const target =
    (providerId && configs.find((c) => c.id === providerId))
    ?? configs.find((c) => activeModelIdOf(c) !== "");
  if (!target) return;
  commit(
    configs.map((c) =>
      c.id === target.id ? { ...c, activeEffort: effort } : c,
    ),
  );
}

/** 内置提供商 id → 名称（给设置页 Model 区用，无配置文件时也能列出） */
export function builtinProviderOptions(): { value: string; label: string }[] {
  return BUILTIN_IDS.map((id) => ({ value: id, label: PROVIDER_DEFAULTS[id] }));
}
