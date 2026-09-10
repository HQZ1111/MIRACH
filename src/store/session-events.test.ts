/**
 * session-events 单元测试：会话归属 + (sessionId, seq) 去重
 *
 * 引擎 seq 是每会话单调的——只按 seq 去重会让跨会话同 seq 事件互相挤掉
 * （装配层串台）。这里锁死归属语义。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/dsh-assembly/store", () => ({
  ingestAssemblyEvents: vi.fn(),
  resetAssembly: vi.fn(),
}));

const { $rawEvents, $rawSessionId, pushRawEvent, pushRawEvents, resetRawEvents } = await import(
  "./session-events"
);

describe("session-events", () => {
  beforeEach(() => {
    resetRawEvents(null);
  });

  it("首个 push 确定归属，同会话内按 seq 去重", () => {
    pushRawEvent("s1", 1, "turn/start", {});
    pushRawEvent("s1", 2, "assistant/chunk", {});
    pushRawEvent("s1", 2, "assistant/chunk", {});
    expect($rawSessionId.get()).toBe("s1");
    expect($rawEvents.get().map((e) => e.seq)).toEqual([1, 2]);
  });

  it("跨会话事件被拒绝（不串台）", () => {
    pushRawEvent("s1", 1, "turn/start", {});
    pushRawEvent("s2", 1, "turn/start", {});
    pushRawEvent("s2", 2, "turn/end", {});
    expect($rawEvents.get().map((e) => e.seq)).toEqual([1]);
    expect($rawEvents.get().every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("reset 到新会话后旧会话事件仍被拒绝", () => {
    pushRawEvent("s1", 1, "turn/start", {});
    resetRawEvents("s2");
    pushRawEvent("s1", 2, "turn/start", {});
    expect($rawEvents.get()).toHaveLength(0);
    pushRawEvent("s2", 5, "turn/start", {});
    expect($rawEvents.get().map((e) => e.seq)).toEqual([5]);
  });

  it("批量摄入按 seq 排序并与现有事件去重", () => {
    pushRawEvents("s1", [
      { seq: 3, type: "c", data: {} },
      { seq: 1, type: "a", data: {} },
    ]);
    pushRawEvents("s1", [
      { seq: 1, type: "a", data: {} },
      { seq: 2, type: "b", data: {} },
    ]);
    expect($rawEvents.get().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect($rawEvents.get().every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("非法 seq 被忽略", () => {
    pushRawEvent("s1", Number.NaN, "x", {});
    pushRawEvent("s1", -1, "x", {});
    expect($rawEvents.get()).toHaveLength(0);
  });
});
