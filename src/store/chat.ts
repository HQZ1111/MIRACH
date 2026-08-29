/**
 * chat - 实时聊天消息 store（VITE_MOCK=0 时使用）
 *
 * 用户消息由 Composer 发送时写入；AI 回复由 relay:reply 事件写入。
 * mock 模式按会话隔离，走 session-chat store（本 store 不被使用）。
 * 会话 id 暂用固定 "main"（hermes-http 按 session_id 隐式建会话）。
 */

import { atom } from "nanostores";
import { setLastFailedPrompt } from "@/store/retry";
import { $sessions, createSession, markSessionContent, hasSessionContent, touchSessionPreview } from "@/store/sessions";
import { $activeSessionId } from "@/store/session";
import { addToolCall, clearToolCalls } from "@/store/tool-calls";
import { $selectedProjectId, addProjectSession } from "@/store/projects";

/** 引擎工具名 → ToolCall.category（与 useStreamingReply 相同映射；回放灌 store 用） */
function toolCategory(name: string): "edit" | "explore" | "run" | "delegate" | "other" {
  const n = name.toLowerCase();
  if (n.includes("edit") || n.includes("write") || n.includes("patch")) return "edit";
  if (n.includes("read") || n.includes("search") || n.includes("grep") || n.includes("explore")) return "explore";
  if (n.includes("bash") || n.includes("run") || n.includes("exec") || n.includes("terminal")) return "run";
  if (n.includes("delegate") || n.includes("subagent") || n.includes("agent")) return "delegate";
  return "other";
}

/** dsh 风格工具调用（dsh ToolRow 展示：参数 + 状态 + 结果）。 */
export interface DshToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "completed" | "error";
  /** 最终结果文本（tool/result 的 message text） */
  result?: string;
  /** 流式过程中的部分输出（tool_execution_update） */
  partialOutput?: string;
  isError?: boolean;
}

/** 上下文压缩标记（dsh compaction/summary 事件） */
export interface CompactionInfo {
  count: number;
  tokens: number;
  summary?: string;
}

export interface LiveChatMessage {
  id: string;
  role: "user" | "ai" | "system";
  text: string;
  /** 模型思考过程（thinking_delta 累加；dsh 引擎的 reasoning 内容） */
  thinking?: string;
  time: string;
  /** 消息日期（YYYY-MM-DD；日期分隔线用，缺省视为今天） */
  date?: string;
  /** 工具消息标记（tool.start/complete 更新用） */
  toolId?: string;
  /** 引擎 assistant 消息 id（message_end 携带；反馈上报 target） */
  engineId?: string;
  /** dsh 风格：挂在该 AI 消息上的工具调用（tool_execution_* 事件桥接） */
  toolCalls?: DshToolCallInfo[];
  /** dsh 风格：上下文压缩标记（compaction/summary 事件） */
  compaction?: CompactionInfo;
}

export const SESSION_ID = "main";

export const $liveMessages = atom<LiveChatMessage[]>([]);

/**
 * 新建任务（对齐 dsh 的 New Session 语义）：
 * - 当前会话空白 → 复用当前会话；
 * - 否则在会话列表中找任意空白会话复用（dsh：空白会话被复用而非堆积）；
 * - 没有空白会话才新建。
 * 空白判定见 hasSessionContent（历史回放/发送消息时标记）。
 */
export function newTaskSession(): string {
  const activeId = $activeSessionId.get();
  const isBlank = (id: string): boolean => !hasSessionContent(id);
  if (activeId && isBlank(activeId)) return activeId;
  const blank = $sessions.get().find((s) => !s.archived && s.id !== activeId && isBlank(s.id));
  if (blank) return blank.id;
  const created = createSession("新会话").id;
  // 新对话页画廊选中的项目：新建任务自动挂到它（项目树可见）
  const pid = $selectedProjectId.get();
  if (pid) addProjectSession(pid, "新会话");
  return created;
}

/** AI 是否正在流式输出（真实模式：delta 流中为 true，定稿/结束为 false） */
export const $aiStreaming = atom(false);

/** 当前流式 AI 消息 id（message.start 记录；delta/complete 按它定位，防气泡分裂/丢文本） */
export const $currentAiId = atom<string | null>(null);

/** 已定稿消息 id 集合：finalize（complete/error/Stop）后迟到的 delta 一律拒收，
 *  防止流式状态机被打穿（定稿后 append 重拉 $aiStreaming，UI 永久卡「流式中」）。 */
const finalizedIds = new Set<string>();

/** 自动朗读新回复（Composer「朗读回复」开关） */
export const $autoSpeak = atom(false);

let idSeq = 0;

function fmtTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function appendUserMessage(text: string): void {
  $aiStreaming.set(false); // 新回合开始，结束上一轮流式
  // 新消息发送 → 清掉上次失败的"重试"条
  setLastFailedPrompt(null);
  const sid = $activeSessionId.get();
  markSessionContent(sid); // 发送消息 → 该会话视为有内容（对齐 dsh 空白语义）
  touchSessionPreview(sid, text); // 会话列表即时刷新预览（左栏不再滞后）
  const m: LiveChatMessage = {
    id: `u${Date.now()}_${idSeq++}`,
    role: "user",
    text,
    time: fmtTime(),
    date: fmtDate(),
  };
  $liveMessages.set([...$liveMessages.get(), m]);
}

export function appendAiMessage(text: string, thinking?: string): void {
  $aiStreaming.set(false);
  const m: LiveChatMessage = {
    id: `a${Date.now()}_${idSeq++}`,
    role: "ai",
    text,
    ...(thinking ? { thinking } : {}),
    time: fmtTime(),
    date: fmtDate(),
  };
  $liveMessages.set([...$liveMessages.get(), m]);
}

/** 清空实时会话（切换会话/回放历史前用）。 */
export function clearLiveMessages(): void {
  $liveMessages.set([]);
  $aiStreaming.set(false);
  $currentAiId.set(null);
  finalizedIds.clear();
}

/** 消息开始（message.start）：记录当前流式 AI 消息 id，进入流式态 */
export function startAiMessage(id: string): void {
  finalizedIds.delete(id);
  $currentAiId.set(id);
  $aiStreaming.set(true);
}

// ── delta 合帧缓冲 ────────────────────────────────────────────────────────
// 高频 delta（每秒 5~20 个、逐条全量 set 数组 + MarkdownText 全量重解析）
// 是长对话流式卡顿的主因：按 90ms 合帧写入，完成时立即 flush。

const pendingDeltas = new Map<string, { thinking: string; text: string }>();
let deltaFlushTimer: number | null = null;

function flushDeltas(): void {
  if (deltaFlushTimer !== null) {
    window.clearTimeout(deltaFlushTimer);
    deltaFlushTimer = null;
  }
  if (pendingDeltas.size === 0) return;
  const list = $liveMessages.get();
  let next = list;
  const applyOne = (id: string, add: { thinking: string; text: string }) => {
    if (finalizedIds.has(id)) return; // Stop 后残留缓冲丢弃
    const idx = next.findIndex((m) => m.id === id && m.role === "ai");
    if (idx === -1) {
      if (!add.thinking && !add.text) return;
      next = [
        ...next,
        { id, role: "ai", text: add.text, ...(add.thinking ? { thinking: add.thinking } : {}), time: fmtTime(), date: fmtDate() },
      ];
      return;
    }
    const cur = next[idx];
    next = [...next];
    next[idx] = { ...cur, text: cur.text + add.text, thinking: (cur.thinking ?? "") + add.thinking };
  };
  for (const [id, add] of pendingDeltas) applyOne(id, add);
  pendingDeltas.clear();
  if (next !== list) $liveMessages.set(next);
}

function scheduleDeltaFlush(): void {
  if (deltaFlushTimer === null) {
    deltaFlushTimer = window.setTimeout(flushDeltas, 90);
  }
}

/** 流式追加：按 messageId 定位到该 AI 消息追加（工具/状态消息插入后仍回到原气泡，不分裂）。
 *  首个 delta 立即建气泡；后续 delta 进合帧缓冲（90ms 批量写 store）。 */
export function appendAiDelta(id: string, delta: string): void {
    if (!delta) return;
    if (finalizedIds.has(id)) return; // 已定稿（complete/error/Stop）后迟到的 delta：拒收
    $aiStreaming.set(true);
    const list = $liveMessages.get();
    const idx = list.findIndex((m) => m.id === id && m.role === "ai");
    if (idx === -1) {
      // 无对应消息（message.start 未被消费）：仅有实际内容时新建，杜绝空气泡
      if (!delta.trim()) return;
      $currentAiId.set(id);
      $liveMessages.set([
        ...list,
        { id, role: "ai", text: delta, time: fmtTime(), date: fmtDate() },
      ]);
      pendingDeltas.delete(id);
      return;
    }
    const add = pendingDeltas.get(id) ?? { thinking: "", text: "" };
    pendingDeltas.set(id, { thinking: add.thinking, text: add.text + delta });
    scheduleDeltaFlush();
}

/** 流式追加思考内容（thinking_delta）：按 messageId 定位到该 AI 消息的 thinking 字段。
 *  同样走合帧缓冲（thinking 高频且长，是流式渲染的另一大热点）。 */
export function appendAiThinking(id: string, delta: string): void {
  if (!delta) return;
  if (finalizedIds.has(id)) return; // 定稿后迟到 delta 拒收（与 appendAiDelta 一致）
  $aiStreaming.set(true);
  const list = $liveMessages.get();
  const idx = list.findIndex((m) => m.id === id && m.role === "ai");
  if (idx === -1) {
    $currentAiId.set(id);
    $liveMessages.set([
      ...list,
      { id, role: "ai", text: "", thinking: delta, time: fmtTime(), date: fmtDate() },
    ]);
    return;
  }
  const add = pendingDeltas.get(id) ?? { thinking: "", text: "" };
  pendingDeltas.set(id, { thinking: add.thinking + delta, text: add.text });
  scheduleDeltaFlush();
}

/** 工具调用开始（tool_execution_start）：把调用挂到指定 AI 消息。 */
export function appendAiTool(id: string, call: DshToolCallInfo): void {
  const list = $liveMessages.get();
  let idx = list.findIndex((m) => m.id === id && m.role === "ai");
  if (idx === -1) {
    // 工具事件先于 message_start 到达：优先挂在当前流式消息（$currentAiId），
    // 其次最后一条 AI —— 避免挂到上一条已定稿回合
    const streamingId = $currentAiId.get();
    if (streamingId) idx = list.findIndex((m) => m.id === streamingId && m.role === "ai");
    if (idx === -1) idx = list.map((m) => m.role).lastIndexOf("ai");
    if (idx === -1) return;
  }
  const next = [...list];
  const existing = next[idx].toolCalls ?? [];
  if (existing.some((c) => c.id === call.id)) return; // 同 id 不重复挂
  next[idx] = { ...next[idx], toolCalls: [...existing, call] };
  $liveMessages.set(next);
}

/** 工具调用更新（tool_execution_update/end）：按 toolId 更新 AI 消息上的调用。 */
export function updateAiTool(id: string, toolId: string, patch: Partial<DshToolCallInfo>): void {
  const list = $liveMessages.get();
  let idx = list.findIndex((m) => m.id === id && m.role === "ai");
  if (idx === -1) {
    // 与 appendAiTool 的回退一致：当前流式消息 → 最后一条 AI
    const streamingId = $currentAiId.get();
    if (streamingId) idx = list.findIndex((m) => m.id === streamingId && m.role === "ai");
    if (idx === -1) idx = list.map((m) => m.role).lastIndexOf("ai");
    if (idx === -1) return;
  }
  const next = [...list];
  const calls = next[idx].toolCalls ?? [];
  const ci = calls.findIndex((c) => c.id === toolId);
  if (ci === -1) {
    // start 事件丢失（如从 message_update toolcall_end 到达）：补挂 running 记录
    next[idx] = {
      ...next[idx],
      toolCalls: [
        ...calls,
        { id: toolId, name: patch.name ?? "tool", args: {}, status: "running", ...patch },
      ],
    };
  } else {
    const updated = [...calls];
    updated[ci] = { ...updated[ci], ...patch };
    next[idx] = { ...next[idx], toolCalls: updated };
  }
  $liveMessages.set(next);
}

/** 上下文压缩标记（compaction/summary）：插入一条 system 消息，dsh 风格渲染为压缩行。 */
export function appendCompactionMessage(info: CompactionInfo): void {
  $liveMessages.set([
    ...$liveMessages.get(),
    { id: `c${Date.now()}_${idSeq++}`, role: "system", text: "", time: fmtTime(), date: fmtDate(), compaction: info },
  ]);
}

/**
 * 流式定稿：用权威文本替换指定 AI 消息（按 messageId，防覆盖上一轮/丢文本）。
 * id 为空或 text 未提供：仅复位流式状态（Stop 保留半成品用）。
 * 定稿后该 id 进入 finalizedIds：迟到的 delta 被 appendAiDelta 拒收；
 * 已被 Stop 定稿（finalizedIds 已含该 id）的消息不再被迟到的 complete 覆盖。
 */
export function finalizeAiMessage(id: string | null, text?: string, engineId?: string): void {
    flushDeltas(); // 先落缓冲（权威文本覆盖前的最后合帧）
    $aiStreaming.set(false);
    $currentAiId.set(null);
    if (id && finalizedIds.has(id) && text !== undefined) return; // Stop 停掉的半成品不被 complete 覆盖
    if (id) finalizedIds.add(id);
    if (!id || text === undefined || !text.trim()) return; // 空文本不落新气泡（纯工具回合）
    const list = $liveMessages.get();
    const idx = list.findIndex((m) => m.id === id);
    if (idx === -1) {
      // 兜底：找不到（如 complete 直达）时新建，避免权威文本被丢弃
      $liveMessages.set([
        ...list,
        { id, role: "ai", text, time: fmtTime(), date: fmtDate(), ...(engineId ? { engineId } : {}) },
      ]);
      return;
    }
    const next = [...list];
    next[idx] = { ...next[idx], text, ...(engineId ? { engineId } : {}) };
    $liveMessages.set(next);
  }

export function appendSystemMessage(text: string): void {
  // 注意：不再复位 $aiStreaming —— 状态/系统消息（status.update）在流式中出现时
  // 不应打灭流式指示器；错误/结束路径由 message.error / message.complete 的 finalize 复位。
  const m: LiveChatMessage = {
    id: `s${Date.now()}_${idSeq++}`,
    role: "system",
    text,
    time: fmtTime(),
    date: fmtDate(),
  };
  $liveMessages.set([...$liveMessages.get(), m]);
}

/** 工具调用开始/更新/审批：统一走 tool-calls store（$toolCalls + ToolEntry 卡片），
 *  不再生成 system 文本消息（避免同一工具双轨显示）。事件接线见 hooks/useStreamingReply.ts */

/**
 * 载入引擎历史会话消息（打开历史会话时由 MainPanel 回放调用）。
 * 入参形状 = sidecar dsh_get_history 返回（history.ts 解析产物）：
 *   { role: user|assistant|system, text, thinking?, toolCalls?, compaction? }
 * assistant 的 toolCalls 灌进 $toolCalls（带消息关联 id → 工具行按消息归属
 * 回放可见）；system 消息携带压缩标记一并落地。
 */
export function loadLiveHistory(
  msgs: {
    role: string;
    text?: string;
    thinking?: string;
    toolCalls?: DshToolCallInfo[];
    compaction?: CompactionInfo;
  }[],
): void {
  $aiStreaming.set(false);
  $currentAiId.set(null);
  // 回放前清空本会话工具调用（避免重复灌入）
  clearToolCalls();
  const list: LiveChatMessage[] = msgs.map((m, idx) => {
    const id = `h${idx}`;
    // 内嵌工具调用灌进 $toolCalls（带消息关联 id → 工具行按消息归属回放可见）
    for (const tc of m.toolCalls ?? []) {
      addToolCall(
        {
          name: tc.name,
          category: toolCategory(tc.name),
          status: tc.status,
          title: tc.name,
          detail: Object.keys(tc.args ?? {}).length > 0 ? JSON.stringify(tc.args) : undefined,
          args: tc.args,
        },
        tc.id,
        id,
      );
    }
    return {
      id,
      role: m.role === "user" ? "user" : m.role === "assistant" ? "ai" : "system",
      text: m.text ?? "",
      time: "",
      ...(m.thinking ? { thinking: m.thinking } : {}),
      ...(m.toolCalls && m.toolCalls.length > 0 ? { toolCalls: m.toolCalls } : {}),
      ...(m.compaction ? { compaction: m.compaction } : {}),
    };
  });
  $liveMessages.set(list);
}

export function resetLiveMessages(): void {
  $aiStreaming.set(false);
  $currentAiId.set(null);
  $liveMessages.set([]);
}
