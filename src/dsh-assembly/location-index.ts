/**
 * dsh-assembly/location-index — 会话级 Turn/Step 时间线与事件→Location 索引
 *
 * 拷贝自官方 packages/client/ui-conversation/src/client/conversation/location-index.ts
 * （ConversationLocationIndex）。差异仅有：
 *   1. 事件类型换成本模块的 DshSessionEvent（宽松 data，边界字段按需收窄）；
 *   2. 去掉对 session-controller / dsh-session 类型的依赖；
 *   3. 注释保留原文语义。
 * 折叠/重建/引用稳定语义与官方逐行一致。
 *
 * @module dsh-assembly/location-index
 */

import type {
  ConversationLocation,
  ConversationLocationData,
  ConversationLocationDataStore,
  ConversationStepDataMap,
  ConversationTimelineSnapshot,
  ConversationTurnDataMap,
  StepLocation,
  TurnLocation,
} from "./conversation-locations";
import { payloadCoordinates, type DshSessionEvent } from "./events";

/** 时间线条目：官方 SessionEventLikeEntry 的标量形态。 */
export interface SessionEventEntry {
  readonly event: DshSessionEvent;
}

interface OwnedLocationData {
  readonly owner: string;
  readonly value: unknown;
}

/** 一个 Context 的 Location 数据前后两次发布。 */
export interface ConversationLocationDataChange {
  readonly owner: string;
  readonly previous: ConversationLocationData | null;
  readonly next: ConversationLocationData | null;
}

class MutableLocationDataStore {
  private entries = new Map<string, OwnedLocationData>();

  get(key: string): unknown {
    return this.entries.get(key)?.value;
  }

  remove(owner: string, key: string): boolean {
    const current = this.entries.get(key);
    if (current?.owner !== owner) return false;
    this.entries.delete(key);
    return true;
  }

  set(owner: string, key: string, value: unknown): boolean {
    const current = this.entries.get(key);
    if (current !== undefined && current.owner !== owner) {
      throw new Error(`conversation Location data "${key}" is already owned by ${current.owner}`);
    }
    if (current?.value === value) return false;
    this.entries.set(key, { owner, value });
    return true;
  }

  replace(entries: ReadonlyMap<string, OwnedLocationData>): boolean {
    let changed = this.entries.size !== entries.size;
    if (!changed) {
      for (const [key, value] of entries) {
        const current = this.entries.get(key);
        if (current?.owner !== value.owner || current.value !== value.value) {
          changed = true;
          break;
        }
      }
    }
    if (changed) this.entries = new Map(entries);
    return changed;
  }
}

interface StepDraft {
  readonly turn: number;
  readonly step: number;
  firstSeq: number;
  start?: DshSessionEvent;
  end?: DshSessionEvent;
}

interface TurnDraft {
  readonly turn: number;
  firstSeq: number;
  start?: DshSessionEvent;
  end?: DshSessionEvent;
  readonly steps: Map<number, StepDraft>;
}

const SESSION_LOCATION = { kind: "session" } as const;
const UNRESOLVED_LOCATION = { kind: "unresolved" } as const;

/** 边界事件的 data 收窄（turn/start、step/start、step/end、turn/end）。 */
function boundaryData(event: DshSessionEvent): { turn: number; step?: number } {
  return event.data as { turn: number; step?: number };
}

function sameReferences<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStep(left: StepLocation | undefined, right: StepLocation): boolean {
  return left !== undefined
    && left.start === right.start && left.end === right.end && left.status === right.status
    && left.data === right.data;
}

function sameTurn(left: TurnLocation | undefined, right: TurnLocation): boolean {
  return left !== undefined
    && left.start === right.start && left.end === right.end && left.status === right.status
    && left.data === right.data && sameReferences(left.steps, right.steps);
}

function sameLocation(left: ConversationLocation | undefined, right: ConversationLocation | undefined): boolean {
  if (left === undefined || right === undefined || left.kind !== right.kind) return left === right;
  if (left.kind === "session" || left.kind === "unresolved") return true;
  if (right.kind === "session" || right.kind === "unresolved") return false;
  if (left.kind === "turn" || right.kind === "turn") {
    return left.kind === "turn" && right.kind === "turn" && left.turn.turn === right.turn.turn;
  }
  return left.turn.turn === right.turn.turn && left.step.step === right.step.step;
}

/** 会话拥有的 Turn/Step 时间线与事件→Location 索引。 */
export class ConversationLocationIndex {
  private coordinates = new Map<number, { turn?: number; step?: number; session?: true }>();
  private locations = new Map<number, ConversationLocation>();
  private seqsByTurn = new Map<number, Set<number>>();
  private timeline: ConversationTimelineSnapshot = { turnOrder: [], turns: new Map() };
  private readonly turnDataStores = new Map<number, MutableLocationDataStore>();
  private readonly stepDataStores = new Map<string, MutableLocationDataStore>();
  private currentTurn: number | undefined;
  private currentStep: number | undefined;

  /** 当前引用稳定的 timeline 快照。 */
  snapshot(): ConversationTimelineSnapshot {
    return this.timeline;
  }

  /** 整组替换 Definition 拥有的 Location 值（保留读取端引用稳定）。 */
  replaceData(entries: readonly { readonly owner: string; readonly data: ConversationLocationData }[]): boolean {
    const turns = new Map<number, Map<string, OwnedLocationData>>();
    const steps = new Map<string, Map<string, OwnedLocationData>>();
    for (const { owner, data } of entries) {
      const values = data.kind === "turn"
        ? turns.get(data.turn) ?? new Map<string, OwnedLocationData>()
        : steps.get(stepDataKey(data.turn, requireStep(data))) ?? new Map<string, OwnedLocationData>();
      const current = values.get(data.key);
      if (current !== undefined && current.owner !== owner) {
        throw new Error(`conversation Location data "${data.key}" is already owned by ${current.owner}`);
      }
      values.set(data.key, { owner, value: data.value });
      if (data.kind === "turn") turns.set(data.turn, values);
      else steps.set(stepDataKey(data.turn, requireStep(data)), values);
    }
    let changed = false;
    for (const turn of new Set([...this.turnDataStores.keys(), ...turns.keys()])) {
      changed = this.mutableTurnData(turn).replace(turns.get(turn) ?? new Map()) || changed;
    }
    for (const step of new Set([...this.stepDataStores.keys(), ...steps.keys()])) {
      changed = this.mutableStepData(step).replace(steps.get(step) ?? new Map()) || changed;
    }
    return changed;
  }

  /** 应用 Context 发布的增量 Location 数据变更。 */
  applyData(changes: readonly ConversationLocationDataChange[]): boolean {
    let changed = false;
    for (const change of changes) {
      const previous = change.previous;
      if (previous === null) continue;
      changed = this.storeFor(previous).remove(change.owner, previous.key) || changed;
    }
    for (const change of changes) {
      const next = change.next;
      if (next === null) continue;
      changed = this.storeFor(next).set(change.owner, next.key, next.value) || changed;
    }
    return changed;
  }

  /** 解析一个事件当前的 Location（无 Turn/Step 归属时回落 session）。 */
  locationOf(event: DshSessionEvent): ConversationLocation {
    return this.locations.get(event.seq) ?? SESSION_LOCATION;
  }

  /**
   * 整窗重建时间线（replace/prepend 或边界追加后）。
   * @returns Location 发生变化的 seq 集合。
   */
  rebuild(entries: readonly SessionEventEntry[]): ReadonlySet<number> {
    const previousLocations = this.locations;
    const turns = new Map<number, TurnDraft>();
    const coordinates = new Map<number, { turn?: number; step?: number; session?: true }>();
    let currentTurn: number | undefined;
    let currentStep: number | undefined;

    const turnDraft = (turn: number, seq: number): TurnDraft => {
      let draft = turns.get(turn);
      if (draft === undefined) {
        draft = { turn, firstSeq: seq, steps: new Map() };
        turns.set(turn, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };
    const stepDraft = (turn: number, step: number, seq: number): StepDraft => {
      const owner = turnDraft(turn, seq);
      let draft = owner.steps.get(step);
      if (draft === undefined) {
        draft = { turn, step, firstSeq: seq };
        owner.steps.set(step, draft);
      } else {
        draft.firstSeq = Math.min(draft.firstSeq, seq);
      }
      return draft;
    };

    for (const { event } of entries) {
      const explicit = payloadCoordinates(event);
      if (event.type === "turn/start") {
        currentTurn = boundaryData(event).turn;
        currentStep = undefined;
      }
      if (event.type === "step/start") {
        const d = boundaryData(event);
        currentTurn = d.turn;
        currentStep = d.step;
      }
      if (explicit.session !== true && explicit.turn !== undefined) {
        if (currentTurn !== explicit.turn) currentStep = undefined;
        currentTurn = explicit.turn;
        if (explicit.step !== undefined) currentStep = explicit.step;
      }
      const turn = explicit.session === true ? undefined : explicit.turn ?? currentTurn;
      const step = explicit.session === true || event.type === "turn/start" || event.type === "turn/end"
        ? undefined
        : explicit.step ?? (turn === currentTurn ? currentStep : undefined);
      coordinates.set(event.seq, {
        ...(turn === undefined ? {} : { turn }),
        ...(turn === undefined || step === undefined ? {} : { step }),
      });
      if (turn !== undefined) turnDraft(turn, event.seq);
      if (turn !== undefined && step !== undefined) stepDraft(turn, step, event.seq);

      if (event.type === "turn/start") {
        turnDraft(boundaryData(event).turn, event.seq).start = event;
      } else if (event.type === "turn/end") {
        turnDraft(boundaryData(event).turn, event.seq).end = event;
      } else if (event.type === "step/start") {
        const d = boundaryData(event);
        stepDraft(d.turn, d.step as number, event.seq).start = event;
      } else if (event.type === "step/end") {
        const d = boundaryData(event);
        stepDraft(d.turn, d.step as number, event.seq).end = event;
      }

      if (event.type === "step/end" && currentTurn === boundaryData(event).turn && currentStep === boundaryData(event).step) {
        currentStep = undefined;
      }
      if (event.type === "turn/end" && currentTurn === boundaryData(event).turn) {
        currentTurn = undefined;
        currentStep = undefined;
      }
    }

    const previousTurns = this.timeline.turns;
    const nextTurns = new Map<number, TurnLocation>();
    const orderedDrafts = [...turns.values()].sort((left, right) => left.firstSeq - right.firstSeq);
    for (const draft of orderedDrafts) {
      const previousTurn = previousTurns.get(draft.turn);
      const previousSteps = new Map(previousTurn?.steps.map(step => [step.step, step]) ?? []);
      const steps = [...draft.steps.values()]
        .sort((left, right) => left.firstSeq - right.firstSeq)
        .map((candidate): StepLocation => {
          const value: StepLocation = {
            turn: candidate.turn,
            step: candidate.step,
            start: candidate.start,
            end: candidate.end,
            status: candidate.end !== undefined
              ? "closed"
              : candidate.start === undefined ? "unknown" : "open",
            data: this.stepData(candidate.turn, candidate.step),
          };
          const previous = previousSteps.get(candidate.step);
          return sameStep(previous, value) ? (previous as StepLocation) : value;
        });
      const value: TurnLocation = {
        turn: draft.turn,
        start: draft.start,
        end: draft.end,
        status: draft.end !== undefined ? "closed" : draft.start === undefined ? "unknown" : "open",
        steps,
        data: this.turnData(draft.turn),
      };
      nextTurns.set(draft.turn, sameTurn(previousTurn, value) ? (previousTurn as TurnLocation) : value);
    }

    const nextOrder = orderedDrafts.map(draft => draft.turn);
    const turnOrder = this.timeline.turnOrder.length === nextOrder.length
      && this.timeline.turnOrder.every((turn, index) => turn === nextOrder[index])
      ? this.timeline.turnOrder
      : nextOrder;
    let sameMap = previousTurns.size === nextTurns.size;
    if (sameMap) {
      for (const [turn, value] of nextTurns) {
        if (previousTurns.get(turn) !== value) {
          sameMap = false;
          break;
        }
      }
    }
    this.timeline = sameMap && turnOrder === this.timeline.turnOrder
      ? this.timeline
      : { turnOrder, turns: nextTurns };
    this.coordinates = coordinates;
    this.locations = new Map();
    this.seqsByTurn = new Map();
    for (const { event } of entries) {
      const coords = this.coordinates.get(event.seq);
      if (coords?.turn !== undefined) this.indexTurnSeq(coords.turn, event.seq);
      this.locations.set(event.seq, this.resolve(event.seq));
    }
    this.currentTurn = currentTurn;
    this.currentStep = currentStep;

    const changed = new Set<number>();
    for (const { event } of entries) {
      if (!sameLocation(previousLocations.get(event.seq), this.locations.get(event.seq))) {
        changed.add(event.seq);
      }
    }
    return changed;
  }

  /**
   * 追加一个 Turn/Step 边界事件（只重访所属 Turn）。
   * @returns Location 引用发生变化的 seq 集合。
   */
  appendBoundary(event: DshSessionEvent): ReadonlySet<number> {
    if (event.type !== "turn/start" && event.type !== "turn/end"
      && event.type !== "step/start" && event.type !== "step/end") {
      throw new Error(`conversation Location boundary expected, received ${event.type}`);
    }
    const d = boundaryData(event);
    const explicit = payloadCoordinates(event);
    if (event.type === "turn/start") {
      this.currentTurn = d.turn;
      this.currentStep = undefined;
    } else if (event.type === "step/start") {
      this.currentTurn = d.turn;
      this.currentStep = d.step;
    }
    if (explicit.turn !== undefined) {
      if (this.currentTurn !== explicit.turn) this.currentStep = undefined;
      this.currentTurn = explicit.turn;
      if (explicit.step !== undefined) this.currentStep = explicit.step;
    }
    const turnNumber = explicit.turn ?? this.currentTurn;
    if (turnNumber === undefined) throw new Error(`conversation boundary ${event.type} has no turn`);
    const stepNumber = event.type === "turn/start" || event.type === "turn/end"
      ? undefined
      : explicit.step ?? (turnNumber === this.currentTurn ? this.currentStep : undefined);
    this.coordinates.set(event.seq, {
      turn: turnNumber,
      ...(stepNumber === undefined ? {} : { step: stepNumber }),
    });
    this.indexTurnSeq(turnNumber, event.seq);

    const previousTurn = this.timeline.turns.get(turnNumber);
    let steps = previousTurn?.steps ?? [];
    if (event.type === "step/start" || event.type === "step/end") {
      const number = d.step as number;
      const previousStep = steps.find(candidate => candidate.step === number);
      const candidate: StepLocation = {
        turn: turnNumber,
        step: number,
        start: event.type === "step/start" ? event : previousStep?.start,
        end: event.type === "step/end" ? event : previousStep?.end,
        status: event.type === "step/end" || previousStep?.end !== undefined ? "closed" : "open",
        data: this.stepData(turnNumber, number),
      };
      const nextStep = sameStep(previousStep, candidate) ? (previousStep as StepLocation) : candidate;
      const index = steps.findIndex(step => step.step === number);
      steps = index < 0
        ? [...steps, nextStep]
        : steps.map((step, at) => (at === index ? nextStep : step));
    }
    const candidate: TurnLocation = {
      turn: turnNumber,
      start: event.type === "turn/start" ? event : previousTurn?.start,
      end: event.type === "turn/end" ? event : previousTurn?.end,
      status: event.type === "turn/end" || previousTurn?.end !== undefined
        ? "closed"
        : event.type === "turn/start" || previousTurn?.start !== undefined ? "open" : "unknown",
      steps,
      data: this.turnData(turnNumber),
    };
    const turn = sameTurn(previousTurn, candidate) ? (previousTurn as TurnLocation) : candidate;
    const turns = new Map(this.timeline.turns);
    turns.set(turnNumber, turn);
    const turnOrder = previousTurn === undefined
      ? [...this.timeline.turnOrder, turnNumber]
      : this.timeline.turnOrder;
    this.timeline = { turnOrder, turns };

    const changed = new Set<number>();
    for (const seq of this.seqsByTurn.get(turnNumber) ?? []) {
      const previous = this.locations.get(seq);
      const next = this.resolve(seq);
      this.locations.set(seq, next);
      if (!sameLocation(previous, next)) changed.add(seq);
    }

    if (event.type === "step/end" && this.currentTurn === d.turn && this.currentStep === d.step) {
      this.currentStep = undefined;
    }
    if (event.type === "turn/end" && this.currentTurn === d.turn) {
      this.currentTurn = undefined;
      this.currentStep = undefined;
    }
    return changed;
  }

  /** 追加一个非边界尾部事件（不重扫窗口）。 */
  appendNonBoundary(event: DshSessionEvent): void {
    const explicit = payloadCoordinates(event);
    if (explicit.session === true) {
      this.coordinates.set(event.seq, {});
      this.locations.set(event.seq, SESSION_LOCATION);
      return;
    }
    if (explicit.turn !== undefined) {
      if (this.currentTurn !== explicit.turn) this.currentStep = undefined;
      this.currentTurn = explicit.turn;
      if (explicit.step !== undefined) this.currentStep = explicit.step;
    }
    const turn = explicit.turn ?? this.currentTurn;
    const step = explicit.step ?? (turn === this.currentTurn ? this.currentStep : undefined);
    this.coordinates.set(event.seq, {
      ...(turn === undefined ? {} : { turn }),
      ...(turn === undefined || step === undefined ? {} : { step }),
    });
    if (turn !== undefined) this.indexTurnSeq(turn, event.seq);
    this.locations.set(event.seq, this.resolve(event.seq));
  }

  private indexTurnSeq(turn: number, seq: number): void {
    const current = this.seqsByTurn.get(turn) ?? new Set<number>();
    current.add(seq);
    this.seqsByTurn.set(turn, current);
  }

  private turnData(turn: number): ConversationLocationDataStore<ConversationTurnDataMap> {
    return this.mutableTurnData(turn) as ConversationLocationDataStore<ConversationTurnDataMap>;
  }

  private stepData(turn: number, step: number): ConversationLocationDataStore<ConversationStepDataMap> {
    return this.mutableStepData(stepDataKey(turn, step)) as ConversationLocationDataStore<ConversationStepDataMap>;
  }

  private mutableTurnData(turn: number): MutableLocationDataStore {
    const current = this.turnDataStores.get(turn) ?? new MutableLocationDataStore();
    this.turnDataStores.set(turn, current);
    return current;
  }

  private mutableStepData(key: string): MutableLocationDataStore {
    const current = this.stepDataStores.get(key) ?? new MutableLocationDataStore();
    this.stepDataStores.set(key, current);
    return current;
  }

  private storeFor(data: ConversationLocationData): MutableLocationDataStore {
    return data.kind === "turn"
      ? this.mutableTurnData(data.turn)
      : this.mutableStepData(stepDataKey(data.turn, requireStep(data)));
  }

  private resolve(seq: number): ConversationLocation {
    const coords = this.coordinates.get(seq);
    if (coords?.turn === undefined) return SESSION_LOCATION;
    const turn = this.timeline.turns.get(coords.turn);
    if (turn === undefined) return UNRESOLVED_LOCATION;
    if (coords.step === undefined) return { kind: "turn", turn };
    const step = turn.steps.find(candidate => candidate.step === coords.step);
    return step === undefined ? { kind: "turn", turn } : { kind: "step", turn, step };
  }
}

function stepDataKey(turn: number, step: number): string {
  return `${turn}:${step}`;
}

function requireStep(data: ConversationLocationData): number {
  if (data.kind === "step" && data.step !== undefined) return data.step;
  throw new Error(`conversation Step data "${data.key}" requires a step`);
}
