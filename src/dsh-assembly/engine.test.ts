/**
 * AssemblyEngine 单元测试：会话归属 + 去重
 *
 * 引擎是单会话折叠器：跨会话摄入必须复位（否则时间线/投影串台），
 * 同一批事件重复摄入（历史回放 + 实时流重叠）必须幂等。
 */
import { describe, expect, it } from "vitest";
import { AssemblyEngine } from "./engine";
import type { DshSessionEvent } from "./events";

const ev = (seq: number, type: string, data: unknown = {}): DshSessionEvent =>
  ({ seq, type, data, time: 0 }) as DshSessionEvent;

describe("AssemblyEngine", () => {
  it("跨会话摄入自动复位（不串台）", () => {
    const engine = new AssemblyEngine();
    engine.ingest([ev(1, "turn/start", { turn: 1 }), ev(2, "turn/end", { turn: 1 })], "s1");
    expect(engine.snapshotTimeline().turnOrder).toEqual([1]);
    // 新会话的回合号不同：不复位会看到 [1, 7]
    engine.ingest([ev(1, "turn/start", { turn: 7 })], "s2");
    expect(engine.snapshotTimeline().turnOrder).toEqual([7]);
  });

  it("同批事件重复摄入幂等（seq 去重）", () => {
    const engine = new AssemblyEngine();
    const batch = [ev(1, "turn/start", { turn: 1 }), ev(2, "turn/end", { turn: 1 })];
    engine.ingest(batch, "s1");
    engine.ingest(batch, "s1");
    expect(engine.snapshotTimeline().turnOrder).toHaveLength(1);
  });

  it("非法事件被忽略", () => {
    const engine = new AssemblyEngine();
    engine.ingest([{ seq: Number.NaN, type: "turn/start", data: { turn: 1 } } as DshSessionEvent], "s1");
    expect(engine.snapshotTimeline().turnOrder).toHaveLength(0);
  });
});
