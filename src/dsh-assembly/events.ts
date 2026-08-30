/**
 * dsh-assembly/events — dsh SessionEvent 原语 + surface 判定 + token 估算
 *
 * 移植自官方 packages/core/session/src/surface.ts（isSurfaceEvent /
 * deriveEventMessage）与 packages/llm/token-meter/src/estimate.ts（固定密度
 * 估算），适配 mirach 的宽松事件类型（data: unknown，按需收窄）。
 * 折叠语义与官方逐字段一致；官方原文件是类型精确版，这里用运行时收窄。
 *
 * @module dsh-assembly/events
 */

/** 官方 surface 事件类型（三条产生模型可见消息的事件）。 */
const SURFACE_EVENT_TYPES = new Set<string>(["user/message", "assistant/message", "tool/result"]);

/** dsh 会话事件（持久化行 / live session.event 通知同形）。 */
export interface DshSessionEvent {
  readonly type: string;
  readonly seq: number;
  readonly time: number;
  readonly data: unknown;
}

/** 事件坐标（turn/step 隶属；turn=null 表示会话级）。 */
interface Coordinates {
  readonly turn?: number;
  readonly step?: number;
  readonly session?: true;
}

/** 从事件 data 收窄 turn/step 坐标（同官方 location-index payloadCoordinates）。 */
export function payloadCoordinates(event: DshSessionEvent): Coordinates {
  const data = event.data as unknown as { turn?: unknown; step?: unknown };
  if (data.turn === null) return { session: true };
  const turn = Number.isSafeInteger(data.turn) && (data.turn as number) >= 0
    ? (data.turn as number)
    : undefined;
  const step = Number.isSafeInteger(data.step) && (data.step as number) >= 0
    ? (data.step as number)
    : undefined;
  return { ...(turn === undefined ? {} : { turn }), ...(step === undefined ? {} : { step }) };
}

/**
 * 事件是否可进入模型可见 surface（类型合格 + 携带 surfaceOp 标记）。
 * 官方对应 isSurfaceEvent；live 通知与持久化行都带 surfaceOp。
 */
export function isSurfaceEvent(event: DshSessionEvent): boolean {
  if (!SURFACE_EVENT_TYPES.has(event.type)) return false;
  return (event as { surfaceOp?: unknown }).surfaceOp !== undefined;
}

/** 消息 content 块（收窄用）。 */
interface ContentBlockLike {
  type: string;
  text?: string;
  name?: string;
  arguments?: string;
  content?: ContentBlockLike[];
}

/** 模型可见消息（收窄用）。 */
interface MessageLike {
  role?: string;
  content: ContentBlockLike[];
}

/**
 * 事件 → 它产生的模型可见消息（官方 deriveEventMessage 同语义）：
 * 空 content 的 assistant/message 只承载 usage，不算消息。
 */
export function deriveEventMessage(event: DshSessionEvent): MessageLike | null {
  switch (event.type) {
    case "user/message":
      return event.data as MessageLike;
    case "assistant/message": {
      const d = event.data as { message?: MessageLike };
      if (!d.message || d.message.content.length === 0) return null;
      return d.message;
    }
    case "tool/result": {
      const d = event.data as { message?: MessageLike };
      return d.message ?? null;
    }
    default:
      return null;
  }
}

// ---- 固定密度估算（官方 token-meter/estimate.ts 逐常量一致） ----

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
export const ROLE_OVERHEAD = 4;

/** 启发式价一个 content 块数组（含块结构开销）。 */
export function estimateContent(blocks: readonly ContentBlockLike[]): number {
  let tokens = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "text":
      case "reasoning":
        tokens += Math.ceil((block.text ?? "").length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
        break;
      case "tool-call":
        tokens += Math.ceil((block.name ?? "").length / CHARS_PER_TOKEN)
          + Math.ceil((block.arguments ?? "").length / CHARS_PER_TOKEN)
          + BLOCK_OVERHEAD;
        break;
      case "tool-result":
        tokens += estimateContent(block.content ?? []) + BLOCK_OVERHEAD;
        break;
      default:
        // 未知块（含图片引用）保留保守的结构化 JSON 价
        tokens += BLOCK_OVERHEAD + Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN);
    }
  }
  return tokens;
}

/** 启发式价一条模型可见消息（content + role 框架开销）。 */
export function estimateMessage(message: MessageLike): number {
  return estimateContent(message.content) + ROLE_OVERHEAD;
}

/** request/header 的 system 段启发式价。 */
export function estimateSystemTokens(header: { system?: string } | undefined): number {
  if (header?.system === undefined) return 0;
  return Math.ceil(header.system.length / CHARS_PER_TOKEN) + ROLE_OVERHEAD;
}

/** request/header 的 tools 段启发式价。 */
export function estimateToolsTokens(header: { tools?: unknown[] } | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0;
  return Math.ceil(JSON.stringify(header.tools).length / CHARS_PER_TOKEN) + BLOCK_OVERHEAD;
}
