/**
 * key-format — 各提供商 API key 格式校验（移植自 zosma key-format.ts）
 *
 * 纯函数正则表（零依赖）：用于设置页输入 key 时的即时格式反馈（非阻断，
 * 仅提示）。未知提供商跳过校验。
 */

/** 各提供商 key 格式正则（google 与 gemini 同属 Google AI 格式，统一用 gemini 键） */
export const KEY_FORMATS: Record<string, RegExp> = {
  anthropic: /^sk-ant-api03-[0-9a-zA-Z]{16,}$/,
  openai: /^sk-(?:proj-)?[0-9a-zA-Z]{20,}$/,
  gemini: /^AIza[0-9A-Za-z_-]{35}$/,
  openrouter: /^sk-or-v1-[0-9a-zA-Z]{16,}$/,
  groq: /^gsk_[0-9a-zA-Z]{16,}$/,
  mistral: /^[A-Za-z0-9]{32}$/,
  deepseek: /^sk-[0-9a-zA-Z]{32,}$/,
  xai: /^xai-[0-9a-zA-Z]{16,}$/,
  fireworks: /^fw_[0-9a-zA-Z]{16,}$/,
};

/** 人类可读的格式提示 */
const FORMAT_HINTS: Record<string, string> = {
  anthropic: "sk-ant-api03-…",
  openai: "sk-… 或 sk-proj-…",
  gemini: "AIza…（39 位）",
  openrouter: "sk-or-v1-…",
  groq: "gsk_…",
  mistral: "32 位字母数字",
  deepseek: "sk-…（32+ 位）",
  xai: "xai-…",
  fireworks: "fw_…",
};

/** 人类可读提供商名 */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Gemini",
  openrouter: "OpenRouter",
  groq: "Groq",
  mistral: "Mistral",
  deepseek: "DeepSeek",
  xai: "xAI",
  fireworks: "Fireworks AI",
};

export interface FormatCheckResult {
  ok: boolean;
  hint?: string;
}

/** 检查 key 是否符合 provider 的格式（未知提供商跳过；非阻断） */
export function checkKeyFormat(provider: string, key: string): FormatCheckResult {
  if (!key.trim()) return { ok: true };
  const pattern = KEY_FORMATS[provider];
  if (!pattern) return { ok: true };
  if (pattern.test(key.trim())) return { ok: true };
  const displayName = PROVIDER_NAMES[provider] ?? provider;
  const expected = FORMAT_HINTS[provider];
  const hint = expected
    ? `这看起来不像 ${displayName} 的 key。${displayName} key 通常以 ${expected} 开头。`
    : `这看起来不像 ${displayName} 的 key——确定就继续。`;
  return { ok: false, hint };
}
