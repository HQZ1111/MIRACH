/**
 * usage — dsh 引擎 token 使用统计（token-meter 的 usage 事件累计）
 *
 * 引擎在每轮 assistant 回合结束发 usage 事件（input/output/cacheRead/reasoning），
 * 两条桥接（默认/简约风格）记录到这里；设置-使用统计读取展示。
 * 统计持久化到 localStorage（hermes.usage.v1），跨启动累计不清零；
 * 「使用统计」页可手动重置。
 */

import { atom } from "nanostores";

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  /** 引擎调用次数（每轮 usage 事件 = 一次 LLM 调用） */
  calls: number;
  /** 最近一轮的输入 tokens ≈ 当前上下文占用（压缩/超限判断参考） */
  lastInputTokens: number;
}

const USAGE_KEY = "mirach.usage.v1";

function load(): UsageRecord {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (raw) {
      const u = JSON.parse(raw) as Partial<UsageRecord>;
      return {
        inputTokens: typeof u.inputTokens === "number" ? u.inputTokens : 0,
        outputTokens: typeof u.outputTokens === "number" ? u.outputTokens : 0,
        cacheReadTokens: typeof u.cacheReadTokens === "number" ? u.cacheReadTokens : 0,
        reasoningTokens: typeof u.reasoningTokens === "number" ? u.reasoningTokens : 0,
        calls: typeof u.calls === "number" ? u.calls : 0,
        lastInputTokens: typeof u.lastInputTokens === "number" ? u.lastInputTokens : 0,
      };
    }
  } catch {
    /* 损坏数据清零 */
  }
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, calls: 0, lastInputTokens: 0 };
}

function persist(u: UsageRecord): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(u));
  } catch {
    /* 配额满等静默 */
  }
}

export const $usage = atom<UsageRecord>(load());

/** 累计一轮 usage（引擎每轮一次）并持久化 */
export function recordUsage(u: Partial<UsageRecord>): void {
  const cur = $usage.get();
  const next: UsageRecord = {
    inputTokens: cur.inputTokens + (u.inputTokens ?? 0),
    outputTokens: cur.outputTokens + (u.outputTokens ?? 0),
    cacheReadTokens: cur.cacheReadTokens + (u.cacheReadTokens ?? 0),
    reasoningTokens: cur.reasoningTokens + (u.reasoningTokens ?? 0),
    calls: cur.calls + 1,
    lastInputTokens: u.inputTokens ?? cur.lastInputTokens,
  };
  $usage.set(next);
  persist(next);
}

/** 重置（手动清空统计，持久层同步清除） */
export function resetUsage(): void {
  const empty = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, calls: 0, lastInputTokens: 0 };
  $usage.set(empty);
  try {
    localStorage.removeItem(USAGE_KEY);
  } catch {
    /* ignore */
  }
}
