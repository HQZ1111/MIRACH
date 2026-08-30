/**
 * chunk-rows — dsh 持久化日志的打包块行解码器
 *
 * 移植自官方 packages/core/session/src/chunk-rows.ts 的 decode 半边
 * （validateRow + expandRow + decodeStorageRecord）。官方说明：打包行是
 * 编码词汇而非会话事件——连续同块 delta chunk（≥3 条）在存储层压成一行
 * text-chunks / reasoning-chunks / tool-call-chunks，seq0/time0 锚定首条，
 * dt 记相邻间隔。本模块把每一行 JSON 还原成原始标量事件序列。
 * 与官方的差异：无 brand 类型与 SessionEvent 精确类型（sidecar 侧宽松处理），
 * 校验不通过时按官方契约 fail-loud（调用方逐行 try/catch 跳过坏行）。
 */

interface RunDataBase {
  turn: number;
  step: number;
  index: number;
  dt: number[];
}

interface TextRunData extends RunDataBase {
  texts: string[];
}

interface ToolCallRunData extends RunDataBase {
  id: string;
  name?: string;
  args: string[];
}

export type ChunkRow =
  | { type: "text-chunks"; seq0: number; time0: number; data: TextRunData }
  | { type: "reasoning-chunks"; seq0: number; time0: number; data: TextRunData }
  | { type: "tool-call-chunks"; seq0: number; time0: number; data: ToolCallRunData };

/** 展开后的事件（与 session.jsonl 行同形；surfaceOp/sourceEventSeqs 信封字段随行保留）。 */
export interface DecodedEvent {
  type: string;
  seq: number;
  time: number;
  data: unknown;
  surfaceOp?: unknown;
  sourceEventSeqs?: unknown;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasExactKeys(value: object, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}

function malformed(tag: string, why: string): never {
  throw new Error(`malformed ${tag} storage row: ${why}`);
}

function validateRunData(tag: string, data: Record<string, unknown>, payloadKey: "texts" | "args"): string[] {
  if (typeof data.turn !== "number" || typeof data.step !== "number" || typeof data.index !== "number") {
    malformed(tag, "turn/step/index must be numbers");
  }
  const payload = data[payloadKey];
  if (!Array.isArray(payload) || payload.length === 0 || payload.some((e) => typeof e !== "string")) {
    malformed(tag, `${payloadKey} must be a non-empty string array`);
  }
  const dt = data.dt;
  if (!Array.isArray(dt) || dt.some((gap) => !Number.isSafeInteger(gap))) {
    malformed(tag, "dt must be an array of safe integers");
  }
  if (dt.length !== payload.length - 1) {
    malformed(tag, `dt length ${dt.length} does not match ${payload.length} members`);
  }
  return payload as string[];
}

function validateRow(value: Record<string, unknown>, tag: ChunkRow["type"]): ChunkRow {
  if (!hasExactKeys(value, ["type", "seq0", "time0", "data"])) {
    malformed(tag, "envelope must be exactly {type, seq0, time0, data}");
  }
  if (!Number.isSafeInteger(value.seq0) || (value.seq0 as number) < 0) {
    malformed(tag, "seq0 must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(value.time0)) {
    malformed(tag, "time0 must be a safe integer");
  }
  const data = value.data;
  if (!isRecord(data)) malformed(tag, "data must be an object");
  let payload: string[];
  if (tag === "tool-call-chunks") {
    const withName = hasExactKeys(data, ["turn", "step", "index", "id", "name", "dt", "args"]);
    if (!withName && !hasExactKeys(data, ["turn", "step", "index", "id", "dt", "args"])) {
      malformed(tag, "data must be exactly {turn, step, index, id, name?, dt, args}");
    }
    if (typeof data.id !== "string" || (withName && typeof data.name !== "string")) {
      malformed(tag, "id (and name when present) must be strings");
    }
    payload = validateRunData(tag, data, "args");
  } else {
    if (!hasExactKeys(data, ["turn", "step", "index", "dt", "texts"])) {
      malformed(tag, "data must be exactly {turn, step, index, dt, texts}");
    }
    payload = validateRunData(tag, data, "texts");
  }
  if (payload.length - 1 > Number.MAX_SAFE_INTEGER - (value.seq0 as number)) {
    malformed(tag, "member seqs must stay safe integers");
  }
  let time = value.time0 as number;
  for (const gap of data.dt as number[]) {
    time += gap;
    if (!Number.isSafeInteger(time)) malformed(tag, "member times must stay safe integers");
  }
  return value as unknown as ChunkRow;
}

/** 展开一个校验过的打包行为原始事件序列。 */
function expandRow(row: ChunkRow): DecodedEvent[] {
  const members = row.type === "tool-call-chunks"
    ? (row.data as ToolCallRunData).args
    : (row.data as TextRunData).texts;
  const base = row.data as RunDataBase;
  const events: DecodedEvent[] = [];
  let time = row.time0;
  for (let k = 0; k < members.length; k++) {
    if (k > 0) time += base.dt[k - 1] as number;
    let chunk: Record<string, unknown>;
    switch (row.type) {
      case "text-chunks":
        chunk = { type: "text-delta", index: base.index, text: members[k] };
        break;
      case "reasoning-chunks":
        chunk = { type: "reasoning-delta", index: base.index, text: members[k] };
        break;
      case "tool-call-chunks": {
        const call = row.data as ToolCallRunData;
        chunk = {
          type: "tool-call-delta",
          index: base.index,
          id: call.id,
          ...(Object.hasOwn(call, "name") ? { name: call.name } : {}),
          argumentsDelta: members[k],
        };
        break;
      }
      default: {
        const unreachable: never = row;
        throw new Error(`chunk-rows received unsupported row ${String(unreachable)}`);
      }
    }
    events.push({
      type: "assistant/chunk",
      seq: row.seq0 + k,
      time,
      data: { turn: base.turn, step: base.step, chunk },
    });
  }
  return events;
}

/**
 * 解码一行 JSONL 的解析结果为它存储的事件序列：打包行校验并展开
 * （坏行 throw——那是损坏存储，静默丢弃会吞掉整段流）；其余行原样通过。
 */
export function decodeStorageRecord(value: unknown): DecodedEvent[] {
  if (!isRecord(value)) return [];
  const tag = value.type;
  if (tag !== "text-chunks" && tag !== "reasoning-chunks" && tag !== "tool-call-chunks") {
    // 普通事件行整行原样通过（保留 surfaceOp/sourceEventSeqs 等信封字段）
    if (typeof value.seq !== "number" || typeof value.time !== "number" || typeof value.type !== "string") {
      return [];
    }
    return [value as DecodedEvent];
  }
  return expandRow(validateRow(value, tag));
}
