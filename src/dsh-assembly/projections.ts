/**
 * dsh-assembly/projections — 官方四个会话投影的纯折叠
 *
 * 逐字段移植自官方源码（去 zod/cordis 化，折叠语义不变）：
 *   - sessionStats   ← packages/session/session-stats/src/projection.ts
 *   - tokenUsage     ← packages/llm/token-meter/src/usage-projection.ts
 *   - contextPressure← 同上（含 surface 影子价协议）
 *   - contextBreakdown← packages/llm/token-meter/src/breakdown-projection.ts
 * apply 返回与官方一致：无变化时返回同一引用（Object.is 门控）。
 * 官方在 replace 违约时 throw（生产者契约破坏）；mirach 面对的是透传流，
 * 降级为中性折叠 + 一次性告警，避免单条脏事件毒化整个统计。
 *
 * @module dsh-assembly/projections
 */

import {
  deriveEventMessage,
  estimateMessage,
  estimateSystemTokens,
  estimateToolsTokens,
  isSurfaceEvent,
  type DshSessionEvent,
} from "./events";

// ---- sessionStats（轮/步计数 + LLM/工具耗时 + 首字延迟 + 解码速度） ----

export interface SessionStatsProjection {
  /** 有已闭合 step 的去重轮数。 */
  turns: number;
  /** 闭合步数（step/end 权威计数，含失败/取消）。 */
  steps: number;
  /** 模型墙钟时间合计（step/start → assistant/message）。 */
  llmMs: number;
  /** 工具墙钟时间合计（tool/call → tool/result 按 callId 配对）。 */
  toolMs: number;
  /** 首字延迟合计。 */
  ttftMs: number;
  /** 记录到首字的步数。 */
  ttftSteps: number;
  /** 解码墙钟合计（首字 → assistant/message）。 */
  decodeMs: number;
  /** 同一批步的输出 token 合计。 */
  decodeTokens: number;
  /** 会话工作总时长（首末事件墙钟跨度）。 */
  durationMs: number;
  /** 纯思考用时合计（每步 reasoning 首 chunk → 末 chunk 的跨度合计）。 */
  thinkingMs: number;
}

/** 是否携带非空首字 delta（官方 isTokenDelta）。 */
function isTokenDelta(chunk: {
  type: string;
  text?: string;
  argumentsDelta?: string;
  name?: string;
}): boolean {
  switch (chunk.type) {
    case "text-delta":
    case "reasoning-delta":
      return chunk.text !== "";
    case "tool-call-delta":
      return chunk.argumentsDelta !== "" || chunk.name !== undefined;
    default:
      return false;
  }
}

interface OpenStep {
  turn: number;
  step: number;
  startTime: number;
  firstTokenTime: number | null;
  /** 本步首个 reasoning chunk（思考起点）。 */
  firstReasoningTime: number | null;
  /** 本步最后一个 reasoning chunk（思考终点）。 */
  lastReasoningTime: number | null;
}

export interface SessionStatsState extends SessionStatsProjection {
  lastTurn: number | null;
  openStep: OpenStep | null;
  pendingCalls: Record<string, number>;
  /** 首个事件时间（工作总时长起点）。 */
  firstTime: number | null;
  /** 最近事件时间。 */
  lastTime: number | null;
}

export function initSessionStats(): SessionStatsState {
  return {
    turns: 0, steps: 0, llmMs: 0, toolMs: 0, ttftMs: 0,
    ttftSteps: 0, decodeMs: 0, decodeTokens: 0,
    durationMs: 0, thinkingMs: 0,
    lastTurn: null, openStep: null, pendingCalls: {},
    firstTime: null, lastTime: null,
  };
}

/** provider 上报的完成 token（与官方同款防御）。 */
function usageOutputTokens(usage: unknown): number | null {
  if (typeof usage !== "object" || usage === null) return null;
  const value = (usage as { outputTokens?: unknown }).outputTokens;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

interface ChunkData {
  turn: number;
  step: number;
  chunk: { type: string; text?: string; argumentsDelta?: string; name?: string; usage?: unknown };
}
interface MessageData {
  turn: number;
  step: number;
  usage?: unknown;
  message?: unknown;
}

/** ES2020 lib 安全的自有键检查（官方用 Object.hasOwn，其 lib 为 es2022）。 */
function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function applySessionStats(state: SessionStatsState, event: DshSessionEvent): SessionStatsState {
  // 会话工作总时长边界（每个事件都推进 lastTime；time=0 的异常事件不参与，
  // 防止把首/末时间锁死在 0 造成 duration 天文数字）
  const t = event.time > 0 ? event.time : null;
  const base: SessionStatsState = {
    ...state,
    firstTime: state.firstTime ?? t,
    lastTime: t ?? state.lastTime,
  };
  switch (event.type) {
    case "step/start": {
      const d = event.data as { turn: number; step: number };
      return {
        ...base,
        openStep: {
          turn: d.turn,
          step: d.step,
          startTime: event.time,
          firstTokenTime: null,
          firstReasoningTime: null,
          lastReasoningTime: null,
        },
      };
    }
    case "assistant/chunk": {
      const d = event.data as ChunkData;
      const open = base.openStep;
      if (open === null || open.turn !== d.turn || open.step !== d.step) return base;
      const chunk = d.chunk;
      if (chunk.type === "reasoning-delta" && chunk.text !== "") {
        // 思考跨度跟踪（首 chunk 起点固定，末 chunk 随流推进）
        return {
          ...base,
          openStep: {
            ...open,
            firstReasoningTime: open.firstReasoningTime ?? event.time,
            lastReasoningTime: event.time,
          },
        };
      }
      if (open.firstTokenTime !== null || !isTokenDelta(chunk)) return base;
      return { ...base, openStep: { ...open, firstTokenTime: event.time } };
    }
    case "assistant/message": {
      const d = event.data as MessageData;
      const open = base.openStep;
      if (open === null || open.turn !== d.turn || open.step !== d.step) return base;
      // 一步至多一条 assembled 消息：闭合边界防重复累计
      const next: SessionStatsState = {
        ...base,
        llmMs: base.llmMs + Math.max(0, event.time - open.startTime),
        thinkingMs: base.thinkingMs + Math.max(0, (open.lastReasoningTime ?? open.firstReasoningTime ?? event.time) - (open.firstReasoningTime ?? event.time)),
        openStep: null,
      };
      if (open.firstTokenTime !== null) {
        next.ttftMs += Math.max(0, open.firstTokenTime - open.startTime);
        next.ttftSteps += 1;
        const outputTokens = usageOutputTokens(d.usage);
        if (outputTokens !== null) {
          next.decodeMs += Math.max(0, event.time - open.firstTokenTime);
          next.decodeTokens += outputTokens;
        }
      }
      return next;
    }
    case "tool/call": {
      const d = event.data as { callId: string };
      return { ...base, pendingCalls: { ...base.pendingCalls, [d.callId]: event.time } };
    }
    case "tool/result": {
      const d = event.data as { message?: { source?: { callId?: string } } };
      const callId = d.message?.source?.callId ?? "";
      // 自有键检查：原型链属性名不得读成已派发（官方同款）
      const dispatched = hasOwn(base.pendingCalls, callId) ? base.pendingCalls[callId] : undefined;
      if (callId === "" || dispatched === undefined) return base;
      const pendingCalls = Object.fromEntries(
        Object.entries(base.pendingCalls).filter(([id]) => id !== callId),
      );
      return { ...base, toolMs: base.toolMs + Math.max(0, event.time - dispatched), pendingCalls };
    }
    case "step/end": {
      const d = event.data as { turn: number };
      return {
        ...base,
        turns: base.lastTurn === d.turn ? base.turns : base.turns + 1,
        steps: base.steps + 1,
        lastTurn: d.turn,
        openStep: null,
      };
    }
    case "turn/end":
      // 结果未落地的调用属于被取消/失败轮：丢弃残留而非无限增长
      return Object.keys(base.pendingCalls).length === 0 ? base : { ...base, pendingCalls: {} };
    default:
      return base;
  }
}

/** 视图：工作总时长 = 首末事件墙钟跨度（0 当事件不足）。 */
function durationOf(s: { firstTime: number | null; lastTime: number | null }): number {
  if (s.firstTime === null || s.lastTime === null) return 0;
  return Math.max(0, s.lastTime - s.firstTime);
}

/** 会话统计视图（totals + 工作总时长）。 */
export function viewSessionStats(state: SessionStatsState): SessionStatsProjection {
  return { ...state, durationMs: durationOf(state) };
}

// ---- tokenUsage（互斥四桶累计） ----

export interface TokenUsageProjection {
  uncachedInputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface TokenUsageState {
  totals: TokenUsageProjection;
  /** 最近一次上报的 turn/step 槽位（同 attempt 的重复上报做替换而非累加）。 */
  last: { turn: number; step: number; buckets: TokenUsageProjection } | null;
}

export type { TokenUsageState };

export function initTokenUsage(): TokenUsageState {
  return { totals: { uncachedInputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, last: null };
}

interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

function bucketsFrom(usage: UsageLike): TokenUsageProjection {
  return {
    uncachedInputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
  };
}

function bucketsEqual(left: TokenUsageProjection, right: TokenUsageProjection): boolean {
  return left.uncachedInputTokens === right.uncachedInputTokens
    && left.outputTokens === right.outputTokens
    && left.cacheReadTokens === right.cacheReadTokens
    && left.cacheWriteTokens === right.cacheWriteTokens;
}

function addReplacing(
  totals: TokenUsageProjection,
  previous: TokenUsageProjection | undefined,
  next: TokenUsageProjection,
): TokenUsageProjection {
  return {
    uncachedInputTokens: totals.uncachedInputTokens - (previous?.uncachedInputTokens ?? 0) + next.uncachedInputTokens,
    outputTokens: totals.outputTokens - (previous?.outputTokens ?? 0) + next.outputTokens,
    cacheReadTokens: totals.cacheReadTokens - (previous?.cacheReadTokens ?? 0) + next.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens - (previous?.cacheWriteTokens ?? 0) + next.cacheWriteTokens,
  };
}

export function applyTokenUsage(state: TokenUsageState, event: DshSessionEvent): TokenUsageState {
  if (event.type === "llm/retry-started") {
    const d = event.data as { turn?: number; step?: number };
    return state.last !== null && state.last.turn === d.turn && state.last.step === d.step
      ? { ...state, last: null }
      : state;
  }
  let turn: number;
  let step: number;
  let usage: UsageLike;
  if (event.type === "assistant/chunk") {
    const d = event.data as ChunkData;
    if (d.chunk?.type !== "usage") return state;
    ({ turn, step } = d);
    usage = (d.chunk.usage ?? {}) as UsageLike;
  } else if (event.type === "assistant/message") {
    const d = event.data as MessageData;
    if (d.usage === undefined) return state;
    ({ turn, step, usage } = { turn: d.turn, step: d.step, usage: d.usage as UsageLike });
  } else {
    return state;
  }

  const buckets = bucketsFrom(usage);
  const previous = state.last !== null && state.last.turn === turn && state.last.step === step
    ? state.last.buckets
    : undefined;
  if (previous !== undefined && bucketsEqual(previous, buckets)) return state;

  return {
    totals: addReplacing(state.totals, previous, buckets),
    last: { turn, step, buckets },
  };
}

// ---- surface 影子价折叠（官方 surface-projection.ts） ----

/** 一次 armed 影子价：紧随其后事件所替换 surface 区间的启发式价。 */
export interface ShadowPriceClaim {
  start: number;
  end: number;
  tokens: number;
}

export interface SurfaceTokensFold {
  readonly deltaTokens: number;
  readonly claim: ShadowPriceClaim | undefined;
}

/** 脏事件一次性告警（避免日志刷屏）。 */
let surfaceContractWarned = false;
function warnSurfaceContract(message: string): void {
  if (surfaceContractWarned) return;
  surfaceContractWarned = true;
  console.warn("[dsh-assembly]", message);
}

/**
 * 折叠一个已提交事件到运行 surface-token 总量（官方 foldSurfaceProjection，
 * throw 降级为中性折叠 + 告警）。
 */
export function foldSurface(
  claim: ShadowPriceClaim | undefined,
  event: DshSessionEvent,
): SurfaceTokensFold {
  if (event.type === "compaction/summary" || event.type === "compaction/prune") {
    const d = event.data as { shadowedRange?: { start: number; end: number }; shadowedTokenCount?: number };
    if (d.shadowedRange && typeof d.shadowedTokenCount === "number") {
      return {
        deltaTokens: 0,
        claim: { start: d.shadowedRange.start, end: d.shadowedRange.end, tokens: d.shadowedTokenCount },
      };
    }
    return { deltaTokens: 0, claim: undefined };
  }
  if (!isSurfaceEvent(event)) return { deltaTokens: 0, claim: undefined };
  const message = deriveEventMessage(event);
  const tokens = message === null ? 0 : estimateMessage(message);
  const op = (event as { surfaceOp?: unknown }).surfaceOp;
  if (op === "append") return { deltaTokens: tokens, claim: undefined };
  // 影子价协议之前的旧日志：中性折叠（漂移优于崩溃）
  if (claim === undefined || typeof op !== "object" || op === null) {
    if (claim === undefined) return { deltaTokens: 0, claim: undefined };
    return { deltaTokens: 0, claim: undefined };
  }
  const replace = op as { op?: string; start: number; end: number };
  if (replace.op !== "replace") return { deltaTokens: 0, claim: undefined };
  if (claim.start !== replace.start || claim.end !== replace.end) {
    warnSurfaceContract(
      `token surface: replace at seq ${event.seq} over ${replace.start}-${replace.end}`
      + ` has no adjacent shadow price (armed claim covers ${claim.start}-${claim.end})`,
    );
    return { deltaTokens: 0, claim: undefined };
  }
  return { deltaTokens: tokens - claim.tokens, claim: undefined };
}

// ---- contextPressure（最新请求占用 + 最新路由容量 + surface 增量重估） ----

export interface ContextPressureProjection {
  pressureTokens?: number;
  projectedTokens?: number;
  contextWindow?: number;
}

export interface ContextPressureState {
  contextWindow?: number;
  pressureTokens?: number;
  surfaceTokens: number;
  sampledSurfaceTokens?: number;
  claim?: ShadowPriceClaim;
}

export function initContextPressure(): ContextPressureState {
  return { surfaceTokens: 0 };
}

/** 最近一次 usage 采样（usage chunk 或 assistant/message）。 */
function usageOf(event: DshSessionEvent): UsageLike | undefined {
  if (event.type === "assistant/chunk") {
    const d = event.data as ChunkData;
    return d.chunk?.type === "usage" ? (d.chunk.usage as UsageLike | undefined) ?? undefined : undefined;
  }
  if (event.type === "assistant/message") {
    const d = event.data as MessageData;
    return d.usage as UsageLike | undefined;
  }
  return undefined;
}

/** 一次请求的 prompt 侧占用：输入 + 缓存流量（不含输出）。 */
function pressureFrom(usage: UsageLike): number {
  return (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

export function applyContextPressure(state: ContextPressureState, event: DshSessionEvent): ContextPressureState {
  const fold = foldSurface(state.claim, event);
  let next = state;
  if (event.type === "request/context") {
    const d = event.data as { contextWindow?: number };
    const contextWindow = d.contextWindow;
    if (contextWindow !== next.contextWindow) {
      if (contextWindow !== undefined) next = { ...next, contextWindow };
      else {
        const { contextWindow: _removed, ...without } = next;
        next = without as ContextPressureState;
      }
    }
  }
  const usage = usageOf(event);
  if (usage !== undefined) {
    const pressureTokens = pressureFrom(usage);
    if (pressureTokens !== next.pressureTokens || next.sampledSurfaceTokens !== next.surfaceTokens) {
      next = { ...next, pressureTokens, sampledSurfaceTokens: next.surfaceTokens };
    }
  }
  if (fold.deltaTokens !== 0) {
    next = { ...next, surfaceTokens: next.surfaceTokens + fold.deltaTokens };
  }
  if (state.claim === undefined && fold.claim === undefined) return next;
  const { claim: _expired, ...withoutClaim } = next;
  return fold.claim === undefined ? (withoutClaim as ContextPressureState) : { ...(withoutClaim as ContextPressureState), claim: fold.claim };
}

export function viewContextPressure(state: ContextPressureState): ContextPressureProjection {
  return {
    ...(state.contextWindow === undefined ? {} : { contextWindow: state.contextWindow }),
    ...(state.pressureTokens === undefined ? {} : { pressureTokens: state.pressureTokens }),
    ...(state.pressureTokens === undefined || state.sampledSurfaceTokens === undefined
      ? {}
      : { projectedTokens: Math.max(0, state.pressureTokens + state.surfaceTokens - state.sampledSurfaceTokens) }),
  };
}

// ---- contextBreakdown（system/tools/message 组成近似） ----

export interface ContextBreakdownProjection {
  systemTokens: number;
  toolsTokens: number;
  messageTokens: number;
}

export interface ContextBreakdownState extends ContextBreakdownProjection {
  claim?: ShadowPriceClaim;
}

export function initContextBreakdown(): ContextBreakdownState {
  return { systemTokens: 0, toolsTokens: 0, messageTokens: 0 };
}

export function applyContextBreakdown(state: ContextBreakdownState, event: DshSessionEvent): ContextBreakdownState {
  const fold = foldSurface(state.claim, event);
  let systemTokens = state.systemTokens;
  let toolsTokens = state.toolsTokens;
  if (event.type === "request/header") {
    // 官方先 canonicalHeader 再估价；mirach 直接读原始 envelope 字段（防御式）
    const d = event.data as { header?: { system?: string; tools?: unknown[] } };
    systemTokens = estimateSystemTokens(d.header);
    toolsTokens = estimateToolsTokens(d.header);
  }
  if (systemTokens === state.systemTokens
    && toolsTokens === state.toolsTokens
    && fold.deltaTokens === 0
    && fold.claim === undefined
    && state.claim === undefined) return state;
  return {
    systemTokens,
    toolsTokens,
    messageTokens: state.messageTokens + fold.deltaTokens,
    ...(fold.claim === undefined ? {} : { claim: fold.claim }),
  };
}
