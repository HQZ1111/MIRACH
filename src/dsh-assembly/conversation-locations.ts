/**
 * dsh-assembly/conversation-locations — Conversation Location 契约类型
 *
 * 拷贝自官方 packages/client/ui-conversation/src/client/contract/conversation.ts
 * 的 Location 子集（Turn/Step 时间线快照、Location 解析、Location 数据存储）。
 * ConversationTurnDataMap / ConversationStepDataMap 保持可声明合并的空接口：
 * mirach 后续业务包（如轨迹 turn 级 usage 挂载）用 declare module 补键。
 *
 * @module dsh-assembly/conversation-locations
 */

import type { DshSessionEvent } from "./events";

/** 可声明合并的 Turn 级业务值表（官方同名词面一致）。 */
export interface ConversationTurnDataMap {}

/** 可声明合并的 Step 级业务值表。 */
export interface ConversationStepDataMap {}

/** Location 业务值的稳定只读读取器。 */
export interface ConversationLocationDataStore<DataMap extends object> {
  get<Key extends keyof DataMap & string>(key: Key): Readonly<DataMap[Key]> | undefined;
}

interface ConversationLocationDataValue {
  readonly kind: "turn" | "step";
  readonly turn: number;
  readonly step?: number;
  readonly key: string;
  readonly value: unknown;
}

type RegisteredTurnData = {
  [Key in keyof ConversationTurnDataMap & string]: {
    readonly kind: "turn";
    readonly turn: number;
    readonly key: Key;
    readonly value: ConversationTurnDataMap[Key];
  };
}[keyof ConversationTurnDataMap & string];

type RegisteredStepData = {
  [Key in keyof ConversationStepDataMap & string]: {
    readonly kind: "step";
    readonly turn: number;
    readonly step: number;
    readonly key: Key;
    readonly value: ConversationStepDataMap[Key];
  };
}[keyof ConversationStepDataMap & string];

/** 一条 Definition 拥有的、挂在引擎 Turn/Step 上的值。 */
export type ConversationLocationData =
  [keyof ConversationTurnDataMap | keyof ConversationStepDataMap] extends [never]
    ? ConversationLocationDataValue
    : RegisteredTurnData | RegisteredStepData;

/** 一个 Agent Step 的不可变边界解析。 */
export interface StepLocation {
  readonly turn: number;
  readonly step: number;
  readonly start: DshSessionEvent | undefined;
  readonly end: DshSessionEvent | undefined;
  readonly status: "open" | "closed" | "unknown";
  readonly data: ConversationLocationDataStore<ConversationStepDataMap>;
}

/** 一个 Agent Turn 的不可变边界解析。 */
export interface TurnLocation {
  readonly turn: number;
  readonly start: DshSessionEvent | undefined;
  readonly end: DshSessionEvent | undefined;
  readonly status: "open" | "closed" | "unknown";
  readonly steps: readonly StepLocation[];
  readonly data: ConversationLocationDataStore<ConversationTurnDataMap>;
}

/** 引擎对一个事件在会话层级里的归属。 */
export type ConversationLocation =
  | { readonly kind: "session" }
  | { readonly kind: "turn"; readonly turn: TurnLocation }
  | { readonly kind: "step"; readonly turn: TurnLocation; readonly step: StepLocation }
  | { readonly kind: "unresolved" };

/** Timeline 快照：Turn 序 + 每 Turn 的 Location。 */
export interface ConversationTimelineSnapshot {
  readonly turnOrder: readonly number[];
  readonly turns: ReadonlyMap<number, TurnLocation>;
}
