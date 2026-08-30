/**
 * dsh-assembly/turn-usage — 每轮精确 token 用量折叠
 *
 * 逐字段移植自官方 packages/llm/token-meter/src/turn-usage.ts 的
 * deriveTurnTokenUsage（去精确类型，折叠语义不变）：对一个 Turn 的
 * turn/start → turn/end 事件切片重建"每次计费尝试"的生命周期
 * （step/start 开 → usage 采样 → assistant/message 落定 → step/end 闭），
 * 任何生命周期缺口/矛盾都让整个披露不可用（undefined），不猜测。
 *
 * @module dsh-assembly/turn-usage
 */

import type { DshSessionEvent } from "./events";

/** 一次计费尝试的 provider/model 归因。 */
export interface TurnTokenUsageRoute {
  readonly provider: string;
  readonly model: string;
}

/** 一个已完成 Turn 的精确 token 账目（官方 TurnTokenUsage 同形）。 */
export interface TurnTokenUsage {
  readonly uncachedInputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly routes?: readonly TurnTokenUsageRoute[];
}

interface NormalizedAttempt {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
  readonly route?: TurnTokenUsageRoute;
}

type AttemptState =
  | { readonly kind: "idle" }
  | { readonly kind: "open"; readonly turn: number; readonly step: number; readonly sample?: Record<string, unknown> }
  | { readonly kind: "finishClosed"; readonly turn: number; readonly step: number }
  | { readonly kind: "settled"; readonly turn: number; readonly step: number; readonly by: "message" | "retry" };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function safeSum(values: readonly number[]): number | undefined {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total)) return undefined;
  }
  return total;
}

function messageRoute(message: unknown): TurnTokenUsageRoute | undefined {
  const source = (message as { source?: { provider?: unknown; model?: unknown } } | undefined)?.source;
  const provider = typeof source?.provider === "string" ? source.provider : "";
  const model = typeof source?.model === "string" ? source.model : "";
  return provider.length > 0 && model.length > 0 ? { provider, model } : undefined;
}

function normalizeUsage(
  usage: Record<string, unknown>,
  route?: TurnTokenUsageRoute,
): NormalizedAttempt | undefined {
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  const cacheReadTokens = usage.cacheReadTokens;
  const cacheWriteTokens = usage.cacheWriteTokens;
  const reasoningTokens = usage.reasoningTokens;
  const totalTokens = usage.totalTokens;
  if (!isCount(inputTokens) || !isCount(outputTokens)) return undefined;
  if (cacheReadTokens !== undefined && !isCount(cacheReadTokens)) return undefined;
  if (cacheWriteTokens !== undefined && !isCount(cacheWriteTokens)) return undefined;
  if (reasoningTokens !== undefined && (!isCount(reasoningTokens) || reasoningTokens > outputTokens)) {
    return undefined;
  }

  const knownPrompt = safeSum([
    inputTokens,
    ...(cacheReadTokens === undefined ? [] : [cacheReadTokens]),
    ...(cacheWriteTokens === undefined ? [] : [cacheWriteTokens]),
  ]);
  if (knownPrompt === undefined) return undefined;

  let exactTotal: number;
  if (totalTokens !== undefined) {
    if (!isCount(totalTokens)) return undefined;
    const exactPrompt = totalTokens - outputTokens;
    if (!isCount(exactPrompt) || exactPrompt < knownPrompt) return undefined;
    if (cacheReadTokens !== undefined && cacheWriteTokens !== undefined && exactPrompt !== knownPrompt) {
      return undefined;
    }
    exactTotal = totalTokens;
  } else {
    if (cacheReadTokens === undefined || cacheWriteTokens === undefined) return undefined;
    const derivedTotal = safeSum([knownPrompt, outputTokens]);
    if (derivedTotal === undefined) return undefined;
    exactTotal = derivedTotal;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens: exactTotal,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(route === undefined ? {} : { route }),
  };
}

function aggregateAttempts(attempts: readonly NormalizedAttempt[]): TurnTokenUsage | undefined {
  if (attempts.length === 0) return undefined;
  const inputTokens = safeSum(attempts.map((a) => a.inputTokens));
  const outputTokens = safeSum(attempts.map((a) => a.outputTokens));
  const totalTokens = safeSum(attempts.map((a) => a.totalTokens));
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) return undefined;

  const cacheRead = attempts.map((a) => a.cacheReadTokens);
  const cacheWrite = attempts.map((a) => a.cacheWriteTokens);
  const reasoning = attempts.map((a) => a.reasoningTokens);
  const cacheReadTokens = cacheRead.every(isCount) ? safeSum(cacheRead) : undefined;
  const cacheWriteTokens = cacheWrite.every(isCount) ? safeSum(cacheWrite) : undefined;
  const reasoningTokens = reasoning.every(isCount) ? safeSum(reasoning) : undefined;

  let routes: readonly TurnTokenUsageRoute[] | undefined;
  const attributed = attempts.map((a) => a.route);
  if (attributed.every((route): route is TurnTokenUsageRoute => route !== undefined)) {
    const unique = new Map<string, TurnTokenUsageRoute>();
    for (const route of attributed) unique.set(`${route.provider}\0${route.model}`, route);
    routes = [...unique.values()];
  }

  return {
    uncachedInputTokens: inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheReadTokens === undefined ? {} : { cacheReadTokens }),
    ...(cacheWriteTokens === undefined ? {} : { cacheWriteTokens }),
    ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
    ...(routes === undefined ? {} : { routes }),
  };
}

function sameAttempt(
  state: Exclude<AttemptState, { kind: "idle" }>,
  turn: number,
  step: number,
): boolean {
  return state.turn === turn && state.step === step;
}

/**
 * 折叠一个完整 Turn 的事件切片为精确 token 账目。
 * @param events - turn/start 到 turn/end 的会话事件切片（按 seq 升序）。
 * @returns 精确聚合，无法证明时 undefined。
 */
export function deriveTurnTokenUsage(events: readonly DshSessionEvent[]): TurnTokenUsage | undefined {
  let state: AttemptState = { kind: "idle" };
  const attempts: NormalizedAttempt[] = [];
  let turn: number | undefined;
  let sawEnd = false;
  let invalid = false;

  const closeOpen = (route?: TurnTokenUsageRoute): boolean => {
    if (state.kind !== "open" || state.sample === undefined) return false;
    const normalized = normalizeUsage(state.sample, route);
    if (normalized === undefined) return false;
    attempts.push(normalized);
    return true;
  };

  for (const event of events) {
    if (invalid) break;
    if (event.type === "turn/start") {
      if (turn !== undefined || state.kind !== "idle") invalid = true;
      else turn = (event.data as { turn?: number }).turn;
      continue;
    }
    if (turn === undefined) {
      invalid = true;
      break;
    }
    if (event.type === "turn/end") {
      if ((event.data as { turn?: number }).turn !== turn || state.kind !== "idle" || sawEnd) invalid = true;
      else sawEnd = true;
      continue;
    }
    if (sawEnd) {
      invalid = true;
      break;
    }
    if (event.type === "step/start") {
      const d = event.data as { turn?: number; step?: number };
      if (d.turn !== turn || state.kind !== "idle") invalid = true;
      else state = { kind: "open", turn, step: d.step as number };
      continue;
    }
    if (event.type === "llm/retry-started") {
      const d = event.data as { turn?: number; step?: number };
      if (d.turn !== turn
        || state.kind !== "settled"
        || state.by !== "retry"
        || !sameAttempt(state, d.turn as number, d.step as number)) invalid = true;
      else state = { kind: "open", turn, step: d.step as number };
      continue;
    }
    if (event.type === "assistant/chunk") {
      const d = event.data as { turn?: number; step?: number; chunk?: { type?: string; usage?: Record<string, unknown>; reason?: { kind?: string } } };
      if (d.turn !== turn
        || state.kind !== "open"
        || !sameAttempt(state, d.turn as number, d.step as number)) {
        invalid = true;
        continue;
      }
      if (d.chunk?.type === "usage") {
        state = { ...state, sample: d.chunk.usage ?? {} };
      } else if (d.chunk?.type === "finish"
        && (d.chunk.reason?.kind === "error" || d.chunk.reason?.kind === "aborted")) {
        if (!closeOpen()) invalid = true;
        else state = { kind: "finishClosed", turn, step: d.step as number };
      }
      continue;
    }
    if (event.type === "assistant/message") {
      const d = event.data as { turn?: number; step?: number; usage?: Record<string, unknown>; message?: unknown };
      if (d.turn !== turn
        || state.kind !== "open"
        || !sameAttempt(state, d.turn as number, d.step as number)) {
        invalid = true;
        continue;
      }
      if (d.usage !== undefined) state = { ...state, sample: d.usage };
      if (!closeOpen(messageRoute(d.message))) invalid = true;
      else state = { kind: "settled", turn, step: d.step as number, by: "message" };
      continue;
    }
    if (event.type === "llm/retry") {
      const d = event.data as { turn?: number; step?: number };
      if (d.turn !== turn || state.kind === "idle"
        || !sameAttempt(state, d.turn as number, d.step as number)) {
        invalid = true;
        continue;
      }
      if (state.kind === "settled" || (state.kind === "open" && !closeOpen())) invalid = true;
      if (!invalid) state = { kind: "settled", turn, step: d.step as number, by: "retry" };
      continue;
    }
    if (event.type === "step/end") {
      const d = event.data as { turn?: number; step?: number };
      if (d.turn !== turn || state.kind === "idle"
        || !sameAttempt(state, d.turn as number, d.step as number)) {
        invalid = true;
        continue;
      }
      if (state.kind === "open" && !closeOpen()) invalid = true;
      if (!invalid) state = { kind: "idle" };
    }
  }

  return invalid || !sawEnd || state.kind !== "idle" ? undefined : aggregateAttempts(attempts);
}

/**
 * 近似轮账目：官方 tokenUsage 投影同款规则（同 turn+step 的重复采样替换
 * 而非累加）对一个 Turn 切片求和。provider 不上报完整桶（如缺 cacheWrite/
 * totalTokens）导致精确账目不可证明时的显示兜底——调用方须以"≈"标注。
 */
export function sumTurnUsage(events: readonly DshSessionEvent[]): TurnTokenUsage | undefined {
  const totals = { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let last: { turn: number; step: number; buckets: typeof totals } | null = null;
  let samples = 0;
  for (const event of events) {
    let usage: Record<string, unknown> | undefined;
    if (event.type === "assistant/chunk") {
      const d = event.data as { chunk?: { type?: string; usage?: Record<string, unknown> } };
      if (d.chunk?.type === "usage") usage = d.chunk.usage;
    } else if (event.type === "assistant/message") {
      usage = (event.data as { usage?: Record<string, unknown> }).usage;
    }
    if (!usage) continue;
    const turn = (event.data as { turn?: unknown }).turn;
    const step = (event.data as { step?: unknown }).step;
    if (typeof turn !== "number" || typeof step !== "number") continue;
    const buckets = {
      uncachedInputTokens: isCount(usage.inputTokens) ? usage.inputTokens : 0,
      outputTokens: isCount(usage.outputTokens) ? usage.outputTokens : 0,
      cacheReadTokens: isCount(usage.cacheReadTokens) ? usage.cacheReadTokens : 0,
      cacheWriteTokens: isCount(usage.cacheWriteTokens) ? usage.cacheWriteTokens : 0,
    };
    const previous = last !== null && last.turn === turn && last.step === step ? last.buckets : undefined;
    totals.uncachedInputTokens += buckets.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0);
    totals.outputTokens += buckets.outputTokens - (previous?.outputTokens ?? 0);
    totals.cacheReadTokens += buckets.cacheReadTokens - (previous?.cacheReadTokens ?? 0);
    totals.cacheWriteTokens += buckets.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0);
    last = { turn, step, buckets };
    samples += 1;
  }
  if (samples === 0) return undefined;
  const totalTokens =
    totals.uncachedInputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  return {
    uncachedInputTokens: totals.uncachedInputTokens,
    outputTokens: totals.outputTokens,
    totalTokens,
    ...(totals.cacheReadTokens > 0 ? { cacheReadTokens: totals.cacheReadTokens } : {}),
    ...(totals.cacheWriteTokens > 0 ? { cacheWriteTokens: totals.cacheWriteTokens } : {}),
  };
}
