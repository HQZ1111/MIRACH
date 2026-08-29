/**
 * providers - 推理提供商注册表 + 连接状态（首次引导与设置页共享）
 *
 * 只存掩码提示 + 连接状态（密钥明文不落盘），localStorage key 沿用旧的
 * "mirach.providerKeys.v1"（历史已保存的提供商自动沿用）。
 */

import { atom } from "nanostores";
import { getApi } from "@/lib/api";
import { CONFIG_RELOAD_EVENT } from "@/hooks/useAppConfig";

export interface ProviderInfo {
  id: string;
  name: string;
  initials: string;
  connected: boolean;
  keyHint?: string;
}

export const PROVIDER_LIST: ProviderInfo[] = [
  { id: "openai", name: "OpenAI", initials: "OP", connected: true, keyHint: "sk-proj-••••••••" },
  { id: "anthropic", name: "Anthropic", initials: "AN", connected: false },
  { id: "deepseek", name: "DeepSeek", initials: "DS", connected: false },
  { id: "deepseek-official", name: "DeepSeek 官方", initials: "DS", connected: false },
  { id: "openrouter", name: "OpenRouter", initials: "OR", connected: false },
  { id: "gemini", name: "Gemini", initials: "GM", connected: false },
  { id: "xai", name: "xAI", initials: "XA", connected: false },
];

const KEY = "mirach.providerKeys.v1";

function load(): ProviderInfo[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Record<string, string>;
      return PROVIDER_LIST.map((p) => (saved[p.id] ? { ...p, connected: true, keyHint: saved[p.id] } : p));
    }
  } catch {
    /* 解析失败回退默认列表 */
  }
  return PROVIDER_LIST;
}

function persist(list: ProviderInfo[]): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        Object.fromEntries(list.filter((p) => p.connected && p.keyHint).map((p) => [p.id, p.keyHint as string])),
      ),
    );
  } catch {
    /* 存储失败忽略 */
  }
}

export const $providers = atom<ProviderInfo[]>(load());

function commit(list: ProviderInfo[]): void {
  persist(list);
  $providers.set(list);
}

export function getProvider(id: string): ProviderInfo | undefined {
  return $providers.get().find((p) => p.id === id);
}

export function hasConnectedProvider(): boolean {
  return $providers.get().some((p) => p.connected);
}

/** 保存 API key：只存掩码提示 + 标记已连接；尝试刷新模型目录（引擎支持时，失败静默） */
export function connectProvider(id: string, rawKey: string): void {
  const key = rawKey.trim();
  if (!key) return;
  const hint = key.length <= 8 ? "••••" : key.slice(0, 3) + "**********" + key.slice(-4);
  commit($providers.get().map((p) => (p.id === id ? { ...p, connected: true, keyHint: hint } : p)));
  void getApi()
    .getModels()
    .then((m) => {
      if (m.length > 0) window.dispatchEvent(new Event(CONFIG_RELOAD_EVENT));
    })
    .catch(() => {});
}

/** OAuth 演示连接（真实模式接入引擎 OAuth 后替换） */
export function connectProviderOAuth(id: string, hint: string): void {
  commit($providers.get().map((p) => (p.id === id ? { ...p, connected: true, keyHint: hint } : p)));
}

export function disconnectProvider(id: string): void {
  commit($providers.get().map((p) => (p.id === id ? { ...p, connected: false, keyHint: undefined } : p)));
}
