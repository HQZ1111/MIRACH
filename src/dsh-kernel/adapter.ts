/**
 * Hermes agent-sidecar — dsh 事件 → pi 事件适配器
 *
 * zosma 前端消费 pi 流式事件（`message_start`/`message_update`/
 * `tool_execution_*`/`message_end`/`agent_end`/`done`），dsh 运行时产出的
 * 是 `session.event`（`turn/start`、`assistant/chunk`、`tool/call`…）。
 * 本模块把两套协议桥接起来，保留 zosma 组件不改动，只改数据入口。
 *
 * 关键语义（与 usePiStream 对齐）：
 *  - 每轮 assistant 子消息开头发 `message_start`（role=assistant）→ 前端 TURN_RESET
 *  - `assistant/chunk` 的 text-delta/reasoning-delta/tool-call-delta 映射到
 *    `message_update` 的 text_delta/thinking_delta/toolcall_end
 *  - 用户消息：直接转发 dsh 的 `user/message` 回显。前端 START_STREAM 已乐观
 *    渲染发送的 prompt，并通过 promptEchoConsumed 跳过发送后的第一个
 *    user message_start；steer/follow-up 的消息在 agent 真正处理时以
 *    user message_start 落地为气泡（QUEUE_UPDATE 的 queuedKinds 匹配）
 *  - 回合结束（turn/end）→ `message_end`；error → `message_end`(error) + `error`
 *  - 运行时 idle → `agent_end` + `done`
 */

import { logDebug } from "./protocol-shim";

/** 输出端：向 Tauri 后端发 `{"type":"event","event":<pi事件>}`。 */
export type Emit = (piEvent: unknown) => void;
/** 队列状态输出端：`{"type":"event","event":{"type":"queue_update",...}}`。 */
export type EmitQueue = (steering: readonly string[], followUp: readonly string[]) => void;

export interface DshAdapterOptions {
  emit: Emit;
  emitQueue: EmitQueue;
  /** 运行时实际使用的 provider/model（request/header 里可以拿到的话）。 */
  provider?: string;
  model?: string;
}

interface BlockTracker {
  index: number;
  type: string;
  toolId?: string;
  toolName?: string;
  toolArgs: string;
}

/** 把 dsh 会话事件流翻译成 pi 事件并 emit。返回 true 表示"这是回合结束"。 */
export function createDshAdapter(opts: DshAdapterOptions) {
  const blocks = new Map<number, BlockTracker>();
  // 会话首个 user/message（= 首轮 prompt 回显）已由 composer 乐观渲染；
  // 前端 promptEchoConsumed 会跳过"发送后第一个 user message_start"，
  // 因此这里直接转发所有 user/message 即可，无需自行抑制。
  let activeTurn = -1;
  void activeTurn;
  let lastToolCallId: string | null = null;
  /** 本回合是否已见首个内容 chunk（用于撤"思考中"占位） */
  let firstContentSeen = false;
  /** 当前回合引擎 assistant 消息 id（feedback.put 需要引擎消息 id 作 target） */
  let lastEngineMessageId: string | null = null;

  const pi = (event: unknown) => opts.emit(event);

  /** 解析 tool call 参数 JSON（模型产出的是原始字符串，非法 JSON 时原样保留）。 */
  function parseArgs(raw: string): Record<string, unknown> {
    if (!raw) return {};
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    } catch {
      return { raw };
    }
  }

  function onTurnStart(turn: number): void {
    activeTurn = turn;
    pi({
      type: "message_start",
      message: {
        role: "assistant",
        content: [],
        model: opts.model,
        provider: opts.provider,
      },
    });
  }

  function onUserMessage(msg: { content?: unknown[]; source?: string }): void {
    // 直接转发回显：前端用 promptEchoConsumed 跳过 prompt 自身，steer/
    // follow-up 的消息则落地为用户气泡（queuedKinds 匹配 kind）。
    const text = (msg.content ?? [])
      .filter((c) => (c as { type?: string }).type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    if (!text) return;
    pi({
      type: "message_start",
      message: {
        role: "user",
        content: [{ type: "text", text }],
      },
    });
  }

  function onChunk(turn: number, step: number, chunk: { type: string; index: number } & Record<string, unknown>): void {
    void turn;
    void step;
    switch (chunk.type) {
      case "block-start": {
        const bt = chunk.blockType as string;
        blocks.set(chunk.index, { index: chunk.index, type: bt, toolArgs: "" });
        break;
      }
      case "text-delta": {
        pi({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: {
            type: "text_delta",
            contentIndex: chunk.index,
            delta: chunk.text,
            partial: { role: "assistant", content: [] },
          },
        });
        break;
      }
      case "reasoning-delta": {
        pi({
          type: "message_update",
          message: { role: "assistant", content: [] },
          assistantMessageEvent: {
            type: "thinking_delta",
            contentIndex: chunk.index,
            delta: chunk.text,
            partial: { role: "assistant", content: [] },
          },
        });
        break;
      }
      case "tool-call-delta": {
        const t = blocks.get(chunk.index);
        if (!t) break;
        if (chunk.name) t.toolName = chunk.name as string;
        if (chunk.id) t.toolId = chunk.id as string;
        // 参数可能以 argumentsDelta（增量）或完整 arguments（一次性）下发，两种都收
        if (typeof chunk.argumentsDelta === "string") t.toolArgs += chunk.argumentsDelta;
        else if (typeof chunk.arguments === "string") t.toolArgs = chunk.arguments;
        break;
      }
      case "usage": {
        // token 计量（token-meter）：转发给前端做使用统计（全字段透传，含 cacheWrite/投影输入）
        const u = chunk.usage as { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number; reasoningTokens?: number } | undefined;
        if (u) {
          pi({ type: "usage", usage: u });
        }
        break;
      }
      case "block-end": {
        const block = chunk.block as { type: string; text?: string; thinking?: string; id?: string; name?: string; arguments?: string; argumentsDelta?: string } | undefined;
        const t = blocks.get(chunk.index);
        if (!t) break;
        if (t.type === "text") {
          const finalText = block?.text ?? "";
          pi({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "text_end",
              contentIndex: chunk.index,
              content: finalText,
              partial: { role: "assistant", content: [] },
            },
          });
        } else if (t.type === "thinking") {
          pi({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "thinking_end",
              contentIndex: chunk.index,
              partial: { role: "assistant", content: [] },
            },
          });
        } else if (t.type === "tool-call") {
          const id = t.toolId ?? block?.id ?? `tc-${chunk.index}`;
          const name = t.toolName ?? block?.name ?? "tool";
          const args = block?.arguments ? parseArgs(block.arguments) : parseArgs(t.toolArgs);
          pi({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "toolcall_end",
              contentIndex: chunk.index,
              toolCall: { type: "toolCall", id, name, arguments: args },
              partial: { role: "assistant", content: [] },
            },
          });
          lastToolCallId = id;
          // 工具执行开始统一由 tool/call 通知（onToolCall，带完整参数）发出，
          // 避免 chunk 流再发一次导致重复卡片 / 空参数覆盖完整参数
        }
        blocks.delete(chunk.index);
        break;
      }
      default:
        break;
    }
  }

  function onToolCall(ev: { callId: string; name: string; arguments: string }): void {
    lastToolCallId = ev.callId;
    pi({
      type: "tool_execution_start",
      toolCallId: ev.callId,
      toolName: ev.name,
      args: parseArgs(ev.arguments),
    });
  }

  function onToolResult(ev: { message?: { content?: unknown[] }; error?: { code?: string; name?: string }; callId?: string }): void {
    const text = (ev.message?.content ?? [])
      .filter((c) => (c as { type?: string }).type === "text")
      .map((c) => (c as { text: string }).text)
      .join("");
    pi({
      type: "tool_execution_end",
      toolCallId: ev.callId ?? lastToolCallId ?? "",
      toolName: "",
      result: { content: text ? [{ type: "text", text }] : [], details: {} },
      isError: Boolean(ev.error),
    });
  }

  /** 引擎错误 → 用户能看懂的中文一句话（欠费/断连/限流/密钥等高频场景）。 */
  function humanizeError(raw: string, code: string): { message: string; retryable: boolean } {
    const s = `${raw} ${code}`;
    const pick = (patterns: RegExp[], _text: string): boolean => patterns.some((p) => p.test(s));
    if (pick([/402|insufficient.*(balance|quota)|billing|余额不足|欠费/i], "")) return { message: "模型账户余额不足（402）——请到提供商处充值后重试", retryable: false };
    if (pick([/401|invalid.*api.*key|unauthorized|authentication/i], "")) return { message: "API 密钥无效或已过期（401）——请在 设置→模型 里检查密钥", retryable: false };
    if (pick([/403|forbidden|permission/i], "")) return { message: "无权访问该模型（403）——检查账户权限或模型名称是否正确", retryable: false };
    if (pick([/429|rate.?limit/i], "")) return { message: "请求过于频繁（429 限流）——稍等片刻会自动重试", retryable: true };
    if (pick([/404|not.?found/i], "")) return { message: "端点或模型不存在（404）——检查 Base URL 与模型 id", retryable: false };
    if (pick([/timeout|timed? ?out/i], "")) return { message: "连接超时——网络波动或服务端无响应，可重试", retryable: true };
    if (pick([/(econn|eai_agai|enotfound|etimedout|fetch failed|socket|network)/i], "")) return { message: "网络连接失败——检查本机网络与 API 地址是否可达", retryable: true };
    if (pick([/missing.?credential|api.?key.*not.*set/i], "")) return { message: "未配置 API 密钥——请在 设置→模型 中补全", retryable: false };
    if (pick([/5\d{2}|internal server/i], "")) return { message: "服务商服务端错误（5xx）——通常稍后恢复，可重试", retryable: true };
    return { message: raw.length > 200 ? raw.slice(0, 200) + "…" : raw, retryable: code === "RATE_LIMITED" };
  }

  function onTurnEnd(reason: { kind: string; error?: { code?: string; message?: string; status?: number } }): void {
    const engineMessageId = lastEngineMessageId ?? undefined;
    lastEngineMessageId = null;
    logDebug("adapter: turn/end kind=%s engineMsgId=%s", reason.kind, engineMessageId ?? "NONE");
    if (reason.kind === "error") {
      const rawCode = reason.error?.code ?? "UNKNOWN";
      const raw = reason.error?.message ?? reason.error?.code ?? "Agent turn failed";
      const { message, retryable } = humanizeError(`${reason.error?.status ?? ""} ${raw}`, rawCode);
      pi({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: message,
        },
        ...(engineMessageId !== undefined ? { engineMessageId } : {}),
      });
      pi({
        type: "error",
        message,
        details: raw.length > 300 ? raw.slice(0, 300) + "…" : raw, // 原始错误留 console 面板排查
        code: rawCode,
        provider: opts.provider,
        model: opts.model,
        retryable,
      });
    } else {
      pi({
        type: "message_end",
        message: { role: "assistant", content: [] },
        ...(engineMessageId !== undefined ? { engineMessageId } : {}),
      });
    }
  }

  function onIdle(): void {
    pi({ type: "agent_end", messages: [] });
    pi({ type: "done" });
  }

  return {
    /** 处理一条 dsh `session.event`；返回 false 表示未知类型（忽略）。 */
    handle(event: { type: string } & Record<string, unknown>): boolean {
      const data = (event.data ?? {}) as Record<string, unknown>;
      switch (event.type) {
        case "turn/start":
          onTurnStart(data.turn as number);
          // 即时反馈：上游网关首包可能迟到数秒~十几秒，先落一条状态行，
          // 避免"发送后空气泡什么都不显示"
          pi({ type: "status.update", status: "🧠 模型思考中（首包延迟取决于服务商）…" });
          return true;
        case "turn/end":
          onTurnEnd(data.reason as { kind: string; error?: { code?: string; message?: string } });
          return true;
        case "user/message": {
          // 只转发真实用户消息；压缩 checkpoint（surfaceOp={op:'replace'}，source 为
          // compact 插件）是写给模型的压缩框架文本，不是用户气泡，直接吞掉。
          // 注意：普通追加消息的 surfaceOp 是顶层字符串 "append"（见 session 日志）。
          const so = (event as Record<string, unknown>).surfaceOp ?? data.surfaceOp;
          const isReplace =
            so === "replace" ||
            (typeof so === "object" && so !== null && (so as { op?: string }).op === "replace");
          if (isReplace) return true;
          // time-context 插件的每步时间采样注入（写给模型感知时间流逝），
          // 不属于用户对话内容，吞掉不进对话区
          const userText = ((data.content ?? []) as { type?: string; text?: string }[])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          if (/^Time sampled while preparing turn \d+, step \d+:/m.test(userText)) return true;
          onUserMessage(data as { content?: unknown[]; source?: string });
          return true;
        }
        case "compaction/start":
        case "compaction/summary":
        case "compaction/end":
        case "compaction/prune": {
          // dsh 压缩生命周期事件 → 前端（compaction_summary 渲染压缩标记行）
          pi({ type: event.type.replace("/", "_"), payload: data });
          return true;
        }
        case "assistant/chunk":
          // 第一个有效内容到达即撤销"思考中"占位（连续相同 status 只插一次的
          // 降噪由前端处理；换文案天然覆盖旧行）
          if (!firstContentSeen) {
            firstContentSeen = true;
            pi({ type: "status.update", status: "✍️ 正在生成回复…" });
          }
          onChunk(data.turn as number, data.step as number, data.chunk as never);
          return true;
        case "assistant/message": {
          // 记录引擎 assistant 消息 id（feedback target）；步的完整内容已由
          // chunk 流 + block-end 送达，这里只更新模型信息
          const m = data.message as { id?: string } | undefined;
          if (m?.id) {
            lastEngineMessageId = m.id;
            logDebug("adapter: engine assistant msg id=%s", m.id);
          } else {
            logDebug("adapter: assistant/message without id");
          }
          return true;
        }
        case "text-chunks": {
          // 批量文本（引擎整段下发）：转成 text_end，保证权威文本不丢
          // （部分回合只有批量事件、没有逐字 text-delta，漏掉会整条消息消失）
          const texts = (Array.isArray(data.texts) ? data.texts : Array.isArray(data.dt) ? data.dt : [])
            .map((x: unknown) => (typeof x === "string" ? x : ""))
            .join("");
          if (texts) {
            pi({
              type: "message_update",
              message: { role: "assistant", content: [] },
              assistantMessageEvent: {
                type: "text_end",
                contentIndex: 0,
                content: texts,
                partial: { role: "assistant", content: [] },
              },
            });
          }
          return true;
        }
        case "reasoning-chunks": {
          // 批量思考：内容已由逐字 reasoning-delta 积累，这里只收尾
          pi({
            type: "message_update",
            message: { role: "assistant", content: [] },
            assistantMessageEvent: {
              type: "thinking_end",
              contentIndex: 0,
              partial: { role: "assistant", content: [] },
            },
          });
          return true;
        }
        case "tool/call":
          onToolCall(data as { callId: string; name: string; arguments: string });
          return true;
        case "tool/result":
          onToolResult(data as { message?: { content?: unknown[] }; error?: { code?: string }; callId?: string });
          return true;
        case "request/header": {
          // 日志型快照；provider/model 以运行时配置为准，忽略
          return true;
        }
        default:
          return false;
      }
    },
    /** 处理 dsh `session.status` 通知（idle → agent_end + done）。 */
    onStatus(status: string): void {
      if (status === "idle") onIdle();
    },
    /** 重置每轮状态（run 之间隔离）。 */
    resetTurn(): void {
      activeTurn = -1;
      lastToolCallId = null;
      firstContentSeen = false;
      blocks.clear();
    },
    debugDump: (evt: unknown) => {
      logDebug("adapter: %j", evt);
    },
  };
}
