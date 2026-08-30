/**
 * API 类型 — 与 Rust 版 Mirach 后端通信的数据契约
 *
 * 对齐 hermes-agent-main 的 tui_gateway JSON-RPC 协议子集
 * （session.* / prompt.submit / message.* 事件 / model.* / skills.* / cron.*）。
 * 完整契约见 docs/api-contract.md。
 */

// ----------------------------------------------------------------
// 会话 / 消息
// ----------------------------------------------------------------

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

/** 会话全文搜索命中（sessions.db FTS5；snippet 含 <mark> 高亮） */
export interface SessionHit {
  sessionId: string;
  title: string;
  role: string;
  snippet: string;
  messageId: number;
}

/** 会话历史消息（打开历史会话渲染） */
export interface SessionHistoryMessage {
  id: number;
  role: string;
  content: string;
}

export type MessageRole = "user" | "assistant" | "system";

export type MessagePart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool"; tool: ToolCallInfo };

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  parts: MessagePart[];
  createdAt: number;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  status: "running" | "completed" | "error";
  detail?: string;
  /** 工具调用参数（dsh ToolRow IN 卡） */
  args?: Record<string, unknown>;
  /** 工具执行结果文本（dsh ToolRow OUT 卡） */
  result?: string;
  /** 流式过程中的部分输出 */
  partialOutput?: string;
}

// ----------------------------------------------------------------
// 模型 / 技能 / 排程
// ----------------------------------------------------------------

export interface ModelOption {
  id: string;
  provider: string;
  label: string;
  price?: { input: number; output: number };
}

export interface SkillSummary {
  id: string;
  name: string;
  enabled: boolean;
  usage?: number;
  /** 引擎技能分类（skills/ 目录子目录名，如 software-development） */
  category?: string;
  description?: string;
  /** 引擎 usage 状态：active | stale | archived */
  state?: string;
  agentCreated?: boolean;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

// ----------------------------------------------------------------
// 引擎斜杠命令 / 认证
// ----------------------------------------------------------------

/** POST /v1/commands 的响应（引擎斜杠命令面：/usage /stop /queue …） */
export interface CommandResult {
  accepted: boolean;
  output: string;
}

/** GET /auth/status 透传（mode: bearer | none） */
export interface AuthStatus {
  /** 引擎不可达时的兜底标记 */
  reachable?: boolean;
  status?: string;
  mode?: "bearer" | "none";
  configured?: boolean;
  authenticated?: boolean;
  identity?: string | null;
  config_error?: string | null;
}

/** ACP 边车可用性（acp_status） */
export interface AcpStatus {
  available: boolean;
  reason?: string | null;
  version?: string | null;
}

// ----------------------------------------------------------------
// 事件（服务端 → 前端推送）
// ----------------------------------------------------------------

export type MirachEvent =
  | { type: "message.start"; sessionId: string; messageId: string }
  | { type: "message.delta"; sessionId: string; messageId: string; partType: "text" | "thinking"; delta: string }
    | { type: "message.complete"; sessionId: string; messageId: string; text?: string; engineMessageId?: string }
  | { type: "message.error"; sessionId: string; messageId?: string; code?: string; retryable?: boolean; message: string }
  | { type: "relay.reply"; sessionId: string; reply: string }
  | { type: "tool.start"; sessionId: string; tool: ToolCallInfo }
  | { type: "tool.update"; sessionId: string; tool: ToolCallInfo }
  | { type: "tool.complete"; sessionId: string; tool: ToolCallInfo }
  | { type: "approval.request"; sessionId: string; tool: ToolCallInfo }
  | { type: "clarify.request"; sessionId: string; question: string; options: string[] }
  | { type: "subagent.start"; sessionId: string; subagent: { id: string; name: string; goal: string; model: string } }
  | { type: "subagent.complete"; sessionId: string; subagent: { id: string; name: string; goal: string; model: string } }
  | { type: "background.complete"; sessionId: string; process: string }
    | { type: "status.update"; sessionId: string; status: string }
    | { type: "compaction.summary"; sessionId: string; info: { count: number; tokens: number; summary?: string } }
    | {
        type: "user_question";
        sessionId: string;
        rpcId: string;
        questions: {
          id: string;
          question: string;
          detail?: string;
          header?: string;
          options?: { label: string; description?: string }[];
          multiSelect?: boolean;
        }[];
      }
  | {
      /** dsh 原始 SessionEvent 透传（seq/type/data 原样）：装配层/定位器的事件底座 */
      type: "raw_session_event";
      seq: number;
      event: { type: string; data: unknown };
    };
