/**
 * tool-calls - 工具调用 store
 *
 * 记录 agent 执行的工具调用（edit/explore/run/delegate），
 * 按会话隔离。每条有状态、类别、可展开详情。
 */

import { computed } from "nanostores";
import {
  $activeSessionId,
  makeSessionMap,
  updateSessionData,
  setSessionData,
} from "./session";

// ----------------------------------------------------------------
// 类型
// ----------------------------------------------------------------

export type ToolCallStatus = "running" | "completed" | "error" | "warning";
export type ToolCallCategory = "edit" | "explore" | "run" | "delegate" | "other";

export interface ToolCall {
  id: string;
  name: string;
  category: ToolCallCategory;
  status: ToolCallStatus;
  title: string;
  detail?: string;
  filesChanged?: string[];
  diffStats?: { added: number; removed: number };
  startedAt: number;
  completedAt?: number;
  durationSec?: number;
  /** 终端/执行命令需要审批 */
  needsApproval?: boolean;
  approved?: boolean;
  /** 工具调用参数（dsh ToolRow IN 卡） */
  args?: Record<string, unknown>;
  /** 工具执行结果文本（dsh ToolRow OUT 卡） */
  result?: string;
  /** 流式过程中的部分输出 */
  partialOutput?: string;
  /** 所属 AI 消息 id（实时=当前流式消息；回放=h{engineId}）——工具行按消息归属 */
  messageId?: string;
}

interface ToolCallState {
  calls: ToolCall[];
}

const DEFAULT_STATE: ToolCallState = { calls: [] };

// ----------------------------------------------------------------
// Store
// ----------------------------------------------------------------

const $toolCallMap = makeSessionMap<ToolCallState>();

/** 当前活跃会话的工具调用列表 */
export const $toolCalls = computed(
  [$activeSessionId, $toolCallMap],
  (sessionId, map) => (map.get(sessionId) ?? DEFAULT_STATE).calls,
);

// ----------------------------------------------------------------
// Actions
// ----------------------------------------------------------------

let idSeq = 0;

export function addToolCall(
  call: Omit<ToolCall, "id" | "startedAt">,
  /** 指定 id（引擎 tool.id，与 AI 消息 toolId 同一命名空间；缺省自生成） */
  id?: string,
  /** 所属 AI 消息 id（工具行按消息归属渲染） */
  messageId?: string,
): string {
  const toolId = id ?? `tc${Date.now()}_${idSeq++}`;
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $toolCallMap,
    sessionId,
    (prev) => ({ calls: [...prev.calls, { ...call, id: toolId, messageId, startedAt: Date.now() }] }),
    DEFAULT_STATE,
  );
  return toolId;
}

export function updateToolCall(id: string, updates: Partial<ToolCall>): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $toolCallMap,
    sessionId,
    (prev) => ({
      calls: prev.calls.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }),
    DEFAULT_STATE,
  );
}

export function completeToolCall(
  id: string,
  status: ToolCallStatus = "completed",
): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $toolCallMap,
    sessionId,
    (prev) => ({
      calls: prev.calls.map((c) =>
        c.id === id
          ? {
              ...c,
              status,
              completedAt: Date.now(),
              durationSec: Math.round((Date.now() - c.startedAt) / 1000),
            }
          : c,
      ),
    }),
    DEFAULT_STATE,
  );
}

export function approveToolCall(id: string): void {
  // 与 completeToolCall 一致：补 completedAt/durationSec，状态字段不缺失
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $toolCallMap,
    sessionId,
    (prev) => ({
      calls: prev.calls.map((c) =>
        c.id === id
          ? {
              ...c,
              approved: true,
              needsApproval: false,
              status: "completed" as const,
              completedAt: Date.now(),
              durationSec: Math.round((Date.now() - c.startedAt) / 1000),
            }
          : c,
      ),
    }),
    DEFAULT_STATE,
  );
}

export function rejectToolCall(id: string): void {
  const sessionId = $activeSessionId.get();
  updateSessionData(
    $toolCallMap,
    sessionId,
    (prev) => ({
      calls: prev.calls.map((c) =>
        c.id === id
          ? {
              ...c,
              approved: false,
              needsApproval: false,
              status: "error" as const,
              completedAt: Date.now(),
              durationSec: Math.round((Date.now() - c.startedAt) / 1000),
            }
          : c,
      ),
    }),
    DEFAULT_STATE,
  );
}

export function clearToolCalls(): void {
  const sessionId = $activeSessionId.get();
  setSessionData($toolCallMap, sessionId, DEFAULT_STATE);
}
