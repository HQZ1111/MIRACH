/**
 * dsh-kernel/dsh-bridge 鈥?鍐呮牳 dsh 浜嬩欢 鈫?pi 浜嬩欢 鈫?MirachEvent 妗? *
 * 澶嶇敤 sidecar 鐨?adapter锛坴ite alias 鎶?protocol.js 鎸囧悜娴忚鍣?shim锛夛紝
 * 杞崲娈电Щ妞嶈嚜 RealClient.submitPromptStream 鐨?onmessage锛坧i 浜嬩欢 鈫? * MirachEvent锛夈€傚唴鏍告ā寮忎笅 adapter.handle(瀹樻柟 SessionEvent) 鐨勪骇鍑虹粡姝? * 鍐欏叆 $chat锛屼笌 sidecar 绠￠亾浜у嚭鍚屽舰銆? */

import { createDshAdapter } from "./adapter";
import { addTodo, updateTodoStatus, removeTodo } from "@/store/todos";
import { recordUsage } from "@/store/usage";
import { addSubagent, updateSubagentStatus } from "@/store/subagents";
import { $activeSessionId } from "@/store/session";
import { handleMirachEvent } from "@/store/chat-events";
import type { MirachEvent } from "@/lib/api/types";

export interface KernelBridge {
  /** 鍠備竴鏉″畼鏂?SessionEvent锛坰ession/follow 鏉＄洰鐨勪簨浠讹級銆?*/
  handle: (ev: { type: string; seq: number; time: number; data: unknown }) => void;
  /** 鍥炲悎杈圭晫锛坱urn/end 鍚庤皟鐢紝閲嶇疆姝ラ鐘舵€侊級銆?*/
  resetTurn: () => void;
  /** 璁板綍鏈鍙戦€佸師鏂囷紙message.error 鐨勯噸璇曟潯鐢級銆?*/
  setSendText: (t: string) => void;
}

/**
 * 鍒涘缓鍐呮牳妗ワ細瀹樻柟 SessionEvent 鈫?adapter锛坧i 浜嬩欢锛夆啋 MirachEvent 鈫? * handleMirachEvent锛?chat锛夈€俿essionId 浣跨敤 $activeSessionId锛堝唴鏍告ā寮? * 鍗曟椿璺冧細璇濓級銆? */
export function createDshBridge(): KernelBridge {
  const sid = (): string => $activeSessionId.get();

  let msgId = "";
  let acc = "";
  let started = false;
  let errorSent = false;
  let pendingEngineId = "";
  let sendText = "";

  const onEvent = (e: MirachEvent): void => {
    handleMirachEvent(e, { sendText, requestSession: sid() });
  };

  const adapter = createDshAdapter({
    emit: (evt: unknown) => {
      const ev = evt as {
        type: string;
        message?: { role?: string; stopReason?: string; errorMessage?: string } | string;
        assistantMessageEvent?: { type?: string; delta?: string; content?: string };
        toolCallId?: string;
        toolName?: string;
        args?: unknown;
        isError?: boolean;
        code?: string;
        retryable?: boolean;
        engineMessageId?: string;
        messages?: unknown[];
      };
      switch (ev.type) {
        case "message_start": {
          if (typeof ev.message === "object" && ev.message?.role === "assistant" && !started) {
            started = true;
            errorSent = false;
            acc = "";
            msgId = `m${Date.now()}`;
            onEvent({ type: "message.start", sessionId: sid(), messageId: msgId });
          }
          break;
        }
        case "message_update": {
          const ame = ev.assistantMessageEvent;
          if (!ame) break;
          if (ame.type === "text_delta" && started) {
            acc += ame.delta ?? "";
            onEvent({ type: "message.delta", sessionId: sid(), messageId: msgId, partType: "text", delta: ame.delta ?? "" });
          } else if (ame.type === "text_end" && started) {
            acc = ame.content ?? acc;
          } else if (ame.type === "thinking_delta" && started) {
            onEvent({ type: "message.delta", sessionId: sid(), messageId: msgId, partType: "thinking", delta: ame.delta ?? "" });
          }
          break;
        }
        case "tool_execution_start": {
          const args = (ev.args ?? {}) as Record<string, unknown>;
          onEvent({
            type: "tool.start",
            sessionId: sid(),
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: String(ev.toolName ?? "tool"),
              status: "running",
              detail: JSON.stringify(ev.args ?? {}),
              args,
            },
          });
          if (ev.toolName === "todo") {
            const a = args;
            const action = String(a.action ?? a.operation ?? "add");
            const content = typeof a.content === "string" ? a.content : typeof a.text === "string" ? a.text : "";
            const tid = typeof a.id === "string" ? a.id : typeof a.todoId === "string" ? String(a.todoId) : content;
            if (action === "complete") updateTodoStatus(tid, "completed");
            else if (action === "remove" || action === "delete") removeTodo(tid);
            else if (content) addTodo(content);
          }
          break;
        }
        case "tool_execution_end": {
          const res = (ev as { result?: { content?: { type?: string; text?: string }[] } }).result;
          const resultText = (res?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          onEvent({
            type: "tool.complete",
            sessionId: sid(),
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: "",
              status: ev.isError ? "error" : "completed",
              ...(resultText ? { result: resultText } : {}),
            },
          });
          break;
        }
        case "message_end": {
          if (typeof ev.engineMessageId === "string" && ev.engineMessageId) {
            pendingEngineId = ev.engineMessageId;
          }
          if (typeof ev.message === "object" && ev.message?.stopReason === "error" && !errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId: sid(),
              messageId: msgId,
              message: String(ev.message.errorMessage ?? "寮曟搸閿欒"),
            });
            started = false;
          }
          break;
        }
        case "error": {
          if (!errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId: sid(),
              messageId: msgId,
              code: String(ev.code ?? ""),
              retryable: Boolean(ev.retryable),
              message: typeof ev.message === "string" ? ev.message : String(ev.code ?? "寮曟搸閿欒"),
            });
            started = false;
          }
          break;
        }
        case "agent_end":
        case "done": {
          if (started) {
            onEvent({
              type: "message.complete",
              sessionId: sid(),
              messageId: msgId,
              text: acc,
              ...(pendingEngineId ? { engineMessageId: pendingEngineId } : {}),
            });
            started = false;
          }
          pendingEngineId = "";
          break;
        }
        case "usage": {
          recordUsage((ev as { usage?: Record<string, number> }).usage ?? {});
          break;
        }
        case "subagent.started": {
          const p = (ev as { params?: Record<string, unknown> }).params ?? {};
          addSubagent(
            p.name ? String(p.name) : String(p.childSessionId ?? "subagent"),
            p.goal ? String(p.goal) : "",
            p.model ? String(p.model) : "",
            p.childSessionId ? String(p.childSessionId) : undefined,
          );
          break;
        }
        case "subagent.finished": {
          const p = (ev as { params?: Record<string, unknown> }).params ?? {};
          const id = String(p.childSessionId ?? "");
          if (id) updateSubagentStatus(id, "completed");
          break;
        }
        case "compaction_summary": {
          const p = (ev as { payload?: { count?: number; tokens?: number; summary?: string } }).payload;
          onEvent({
            type: "compaction.summary",
            sessionId: sid(),
            info: {
              count: typeof p?.count === "number" ? p.count : 0,
              tokens: typeof p?.tokens === "number" ? p.tokens : 0,
              ...(p?.summary ? { summary: p.summary } : {}),
            },
          });
          break;
        }
        default:
          break;
      }
    },
    emitQueue: () => {},
    provider: "deepseek",
    model: "deepseek-v4-flash-0731",
  });

  return {
    handle: (ev) => {
      // user/message 鐢卞彂閫佹柟涔愯涓婂睆锛岃烦杩囬槻鍙屾皵娉?      if (ev.type === "user/message") return;
      adapter.handle(ev);
    },
    resetTurn: () => {
      adapter.resetTurn();
      started = false;
      errorSent = false;
      pendingEngineId = "";
    },
    setSendText: (t: string) => { sendText = t; },
  };
}
