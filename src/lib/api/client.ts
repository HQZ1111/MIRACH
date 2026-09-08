/**
 * MirachClient — 与 Agent 引擎通信的客户端抽象
 *
 * 两种实现：
 * - MockClient（VITE_MOCK=1，默认）：本地演示数据，不发起任何网络请求
 * - RealClient（VITE_MOCK=0）：经 Tauri sidecar 中继（dsh_relay.rs）与
 *   dsh 引擎通信（send_prompt / dsh_rpc 等 stdin JSONL 通道）
 *
 * 通过 getApi()（adapter.ts）获取单例；接真实后端时前端各 store
 * 改为调用本客户端并消费事件。
 */

import type {
  MirachEvent,
  ModelOption,
  SessionHistoryMessage,
  SessionHit,
  SessionSummary,
} from "./types";

export interface MirachClient {
  readonly mode: "mock" | "real";
  listSessions(): Promise<SessionSummary[]>;
  createSession(): Promise<SessionSummary>;
  /** 会话全文搜索（真实模式走 sessions.db FTS5） */
  searchSessions(query: string, limit?: number): Promise<SessionHit[]>;
  /** 打开会话：取历史消息 */
  loadSession(sessionId: string): Promise<SessionHistoryMessage[]>;
  /** 重命名会话（真实模式写引擎 sessions.db） */
  renameSession(sessionId: string, title: string): Promise<void>;
  /** 删除会话（真实模式删引擎 sessions.db + 快照） */
  deleteSession(sessionId: string): Promise<void>;
  /** 流式提交：事件经 onEvent 逐条回调（message.delta / message.complete / message.error …）；
   *  options.reasoningEffort 随请求下发（低/中/高，对齐引擎 reasoning_effort） */
  submitPromptStream(
    sessionId: string,
    text: string,
    onEvent: (e: MirachEvent) => void,
    options?: { reasoningEffort?: string },
  ): Promise<void>;
  getModels(): Promise<ModelOption[]>;
  /** dsh 引擎模型目录（sidecar catalog：内置 deepseek + 设置页配置的提供商） */
  getDSHModels(): Promise<ModelOption[]>;
  /** 转向纠偏（steer_prompt，运行中真打断注入纠偏） */
  steer(guidance: string): Promise<void>;
  /** 消息反馈上报（dsh messageFeedback.put；messageId 用引擎 assistant 消息 id） */
  sendMessageFeedback(messageId: string, rating: "positive" | "negative"): Promise<boolean>;
  /** 社区插件清单（dsh-plugins 目录扫描 + 激活状态） */
  listCommunityPlugins(): Promise<InstalledPluginInfo[]>;
  /** 安装社区插件（npm → junction → patch；返回步骤日志，重启应用后生效） */
  installCommunityPlugin(name: string): Promise<string[]>;
  /** 卸载社区插件（返回步骤日志，重启应用后生效） */
  uninstallCommunityPlugin(name: string): Promise<string[]>;
  /** 引擎更新检查（npm alpha 通道 vs 当前全局安装版本） */
  checkEngineUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }>;
  /** 一键更新引擎（npm i -g @deepseek-ai/dsh@alpha；返回步骤日志） */
  updateEngine(): Promise<string[]>;
  /** 绑定酒馆预设到空白会话（agentPresets.select：世界书/记忆/关系网/剧情选项随挂载激活）。
   *  会话已有回合时引擎拒绝（locked）→ 返回 false；成功返回 true。 */
  selectAgentPreset(sessionId: string, presetId: string): Promise<boolean>;
  /** 官方模型目录（session.modelCatalog：引擎真实可路由模型，按提供商分组） */
  getNativeModelCatalog(): Promise<NativeModelCatalog | null>;
  /** 官方会话选型（session.selectModel：provider/model/reasoningEffort 写入会话持久投影） */
  nativeSelectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<boolean>;
  /** 官方斜杠命令执行（commands.execute：/plan、/permission 等；会话 id 前端→dsh 映射） */
  nativeExecuteCommand(sessionId: string, line: string): Promise<boolean>;
  /** 官方设置描述（settings.describe：命名空间清单 + schema + 当前值） */
  describeSettings(): Promise<{ namespaces: { ns: string; schema: unknown; value: unknown }[] } | null>;
  /** 前端会话 id → dsh 会话 id（官方原生渲染层同步内核 current 会话用） */
  getDshSessionId(sessionId: string): Promise<string | null>;
  /** 引擎插件清单（sidecar 生成 cordis.yml 的装配镜像，config.pluginEntries） */
  listEnginePlugins(): Promise<{ id: string; name: string }[]>;
  /** 订阅服务端事件流；返回取消订阅函数 */
  subscribe(onEvent: (e: MirachEvent) => void): () => void;
}

// ================================================================
// Mock 实现（VITE_MOCK=1：演示数据）
// ================================================================

/** 官方模型目录（session.modelCatalog 返回值；与 dsh-api-session-controller/types 对齐） */
export interface NativeModelCatalogModel {
  id: string;
  name: string;
  description?: string;
  /** 适配器自带的思考档位（低/中/高…） */
  reasoning?: { efforts: { id: string; name: string; description?: string }[]; defaultEffort?: string };
}

/** 一个提供商及其可路由模型 */
export interface NativeModelCatalogGroup {
  id: string;
  name: string;
  models: NativeModelCatalogModel[];
}

/** 官方模型目录：默认选型 + 分组 + 各提供商加载失败信息 */
export interface NativeModelCatalog {
  default: { provider: string; model: string; reasoningEffort?: string };
  routableProviders: readonly string[];
  groups: readonly NativeModelCatalogGroup[];
  failures: readonly { id: string; name: string; message: string }[];
}

/** 社区插件（dsh-plugins 目录里已安装的包） */
export interface InstalledPluginInfo {
  name: string;
  version: string;
  description: string;
  /** package.json 声明 dsh 字段 = 插件包 */
  isPlugin: boolean;
  /** profile cordis.patch.yml 已激活 */
  active: boolean;
  /** junction 已建（profile node_modules 可解析） */
  linked: boolean;
  /** mirach 内置三件（UI 禁用卸载） */
  builtin: boolean;
}

class MockClient implements MirachClient {
  readonly mode = "mock" as const;
  private listeners = new Set<(e: MirachEvent) => void>();

  async listEnginePlugins(): Promise<{ id: string; name: string }[]> {
    return [];
  }

  async listSessions(): Promise<SessionSummary[]> {
    return [
      { id: "s1", title: "前端架构重构方案", createdAt: Date.now() - 3600_000, updatedAt: Date.now() },
      { id: "s2", title: "API 接口设计评审", createdAt: Date.now() - 7200_000, updatedAt: Date.now() },
    ];
  }

  async createSession(): Promise<SessionSummary> {
    return { id: `s${Date.now()}`, title: "新会话", createdAt: Date.now(), updatedAt: Date.now() };
  }

  async searchSessions(query: string): Promise<SessionHit[]> {
    return [
      {
        sessionId: "s1",
        title: "前端架构重构方案",
        role: "assistant",
        snippet: `<mark>${query}</mark> 相关的架构决策记录…`,
        messageId: 1,
      },
    ];
  }

  async loadSession(sessionId: string): Promise<SessionHistoryMessage[]> {
    return [
      { id: 1, role: "user", content: `（mock）会话 ${sessionId} 的历史用户消息` },
      { id: 2, role: "assistant", content: "（mock）历史回复内容" },
    ];
  }

  async renameSession(_sessionId: string, _title: string): Promise<void> {
    /* mock：无操作 */
  }

  async deleteSession(_sessionId: string): Promise<void> {
    /* mock：无操作 */
  }

  async submitPromptStream(
    _sessionId: string,
    _text: string,
    onEvent: (e: MirachEvent) => void,
    _options?: { reasoningEffort?: string },
  ): Promise<void> {
    // mock：300ms 后发一条 delta + complete，演示流式事件形状
    window.setTimeout(() => {
      const id = `m${Date.now()}`;
      onEvent({
        type: "message.delta",
        sessionId: _sessionId,
        messageId: id,
        partType: "text",
        delta: "（mock 流式响应）已收到你的消息，接真实后端后这里会逐块流式返回。",
      });
      onEvent({ type: "message.complete", sessionId: _sessionId, messageId: id });
    }, 300);
  }

  async getModels(): Promise<ModelOption[]> {
    // 对齐 dsh deepseek-official 官方目录（llm-deepseek DEFAULT_MODELS）
    return [
      { id: "deepseek-v4-flash", provider: "DeepSeek", label: "DeepSeek-V4-Flash" },
      { id: "deepseek-v4-pro", provider: "DeepSeek", label: "DeepSeek-V4-Pro" },
    ];
  }

  async getDSHModels(): Promise<ModelOption[]> {
    // mock：与 getModels 一致（dsh 内置目录），输入框目录真实化用
    return this.getModels();
  }

  async steer(_guidance: string): Promise<void> {
    /* mock：无操作 */
  }

  async sendMessageFeedback(_messageId: string, _rating: "positive" | "negative"): Promise<boolean> {
    return true; // mock：本地赞踩即可
  }

  async checkEngineUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
    return { current: "0.1.2-alpha.3", latest: "0.1.2-alpha.3", hasUpdate: false };
  }

  async updateEngine(): Promise<string[]> {
    return ["（mock）无需更新"];
  }

  async selectAgentPreset(_sessionId: string, _presetId: string): Promise<boolean> {
    return false; // mock 无引擎预设
  }

  async getNativeModelCatalog(): Promise<NativeModelCatalog | null> {
    return null; // mock 无官方目录
  }

  async nativeSelectModel(_sessionId: string, _provider: string, _model: string): Promise<boolean> {
    return false; // mock 无官方选型
  }

  async nativeExecuteCommand(_sessionId: string, _line: string): Promise<boolean> {
    return false; // mock 无命令执行
  }

  async describeSettings(): Promise<{ namespaces: { ns: string; schema: unknown; value: unknown }[] } | null> {
    return null; // mock 无设置 schema
  }

  async getDshSessionId(_sessionId: string): Promise<string | null> {
    return null; // mock 无引擎映射
  }

  async listCommunityPlugins(): Promise<InstalledPluginInfo[]> {
    return []; // mock 无插件目录
  }

  async installCommunityPlugin(_name: string): Promise<string[]> {
    return ["（mock）无需安装"];
  }

  async uninstallCommunityPlugin(_name: string): Promise<string[]> {
    return ["（mock）无需卸载"];
  }

  subscribe(onEvent: (e: MirachEvent) => void): () => void {
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }
}

// ================================================================
// 真实实现（VITE_MOCK=0：经 Tauri sidecar 中继 → dsh 引擎）
// 前端不直接请求引擎，而是走 Rust 侧命令（dsh_relay.rs），
// 保持 UI → 中继 → 引擎 三层架构。
// ================================================================

import { Channel, invoke } from "@tauri-apps/api/core";

class RealClient implements MirachClient {
  readonly mode = "real" as const;
  private listeners = new Set<(e: MirachEvent) => void>();

  // 引擎会话列表：直读 sessions.db（sessions_list）
  async listSessions(): Promise<SessionSummary[]> {
    try {
      const raw = await invoke<unknown>("sessions_list");
      const list = Array.isArray(raw) ? raw : [];
      return list.map((s) => {
        const o = s as { id?: string; title?: string; createdAt?: string; updatedAt?: string };
        return {
          id: String(o.id ?? ""),
          title: String(o.title ?? "未命名会话"),
          createdAt: typeof o.createdAt === "string" ? Date.parse(o.createdAt) || 0 : 0,
          updatedAt: typeof o.updatedAt === "string" ? Date.parse(o.updatedAt) || 0 : 0,
        };
      });
    } catch {
      return [];
    }
  }

  async searchSessions(query: string, limit?: number): Promise<SessionHit[]> {
    try {
      return await invoke<SessionHit[]>("sessions_search", { query, limit: limit ?? 20 });
    } catch {
      return [];
    }
  }

  async loadSession(sessionId: string): Promise<SessionHistoryMessage[]> {
    try {
      return await invoke<SessionHistoryMessage[]>("sessions_load", { sessionId });
    } catch {
      return [];
    }
  }

  async renameSession(sessionId: string, title: string): Promise<void> {
    await invoke("sessions_rename", { sessionId, title });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await invoke("sessions_delete", { sessionId });
  }

  // 引擎按 session_id 隐式建会话：本地生成 id
  async createSession(): Promise<SessionSummary> {
    const id = `s${Date.now()}`;
    return { id, title: "新会话", createdAt: Date.now(), updatedAt: Date.now() };
  }

  async steer(guidance: string): Promise<void> {
    // dsh 引擎转向（steer_prompt → sidecar → 运行时插话纠偏）
    if (!guidance.trim()) return;
    try {
      await invoke("steer_prompt", { text: guidance });
    } catch {
      /* 引擎不可达忽略 */
    }
  }

  async submitPromptStream(
    sessionId: string,
    text: string,
    onEvent: (e: MirachEvent) => void,
    _options?: { reasoningEffort?: string },
  ): Promise<void> {
    // dsh 引擎流式提交：经 sidecar → DeepSeek Harness（与简约档 useDSHStream 同管道），
    // pi 事件 → MirachEvent 桥接到 $liveMessages（默认/dsh 对话风格共用显示路径）。
    const { $providerConfig, activeModelIdOf } = await import("@/store/providerConfig");
    const { recordUsage } = await import("@/store/usage");
    const { addTodo, updateTodoStatus, removeTodo } = await import("@/store/todos");
    const { addSubagent, updateSubagentStatus } = await import("@/store/subagents");
    const cfg = $providerConfig.get().find((c) => activeModelIdOf(c) !== "");
    const provider = cfg?.id ?? undefined;
    const model = cfg ? activeModelIdOf(cfg) : undefined;

    const ch = new Channel<Record<string, unknown>>();
    let msgId = "";
    let acc = "";
    let started = false;
    let errorSent = false;
    /** 当前回合引擎 assistant 消息 id（message_end 携带；feedback 上报 target） */
    let pendingEngineId = "";
    ch.onmessage = (raw) => {
      const ev = raw as {
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
      };
      switch (ev.type) {
        case "message_start":
          // 只对 assistant 开新气泡；user 回显已由前端 appendUserMessage 渲染
          if (typeof ev.message === "object" && ev.message?.role === "assistant" && !started) {
            started = true;
            errorSent = false;
            acc = "";
            msgId = `m${Date.now()}`;
            onEvent({ type: "message.start", sessionId, messageId: msgId });
          }
          break;
        case "message_update": {
          const ame = ev.assistantMessageEvent;
          if (ame?.type === "text_delta" && started) {
            acc += ame.delta ?? "";
            onEvent({ type: "message.delta", sessionId, messageId: msgId, partType: "text", delta: ame.delta ?? "" });
          } else if (ame?.type === "text_end" && started) {
            acc = ame.content ?? acc;
          } else if (ame?.type === "thinking_delta" && started) {
            onEvent({ type: "message.delta", sessionId, messageId: msgId, partType: "thinking", delta: ame.delta ?? "" });
          }
          break;
        }
        case "tool_execution_start": {
          const args = (ev.args ?? {}) as Record<string, unknown>;
          onEvent({
            type: "tool.start",
            sessionId,
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: String(ev.toolName ?? "tool"),
              status: "running",
              detail: JSON.stringify(ev.args ?? {}),
              args,
            },
          });
          // dsh todo 工具 → 真实待办 store
          if (ev.toolName === "todo") {
            const action = String(args.action ?? args.operation ?? "add");
            const content = typeof args.content === "string" ? args.content : typeof args.text === "string" ? args.text : "";
            const tid = typeof args.id === "string" ? args.id : typeof args.todoId === "string" ? String(args.todoId) : content;
            if (action === "complete") updateTodoStatus(tid, "completed");
            else if (action === "remove" || action === "delete") removeTodo(tid);
            else if (content) addTodo(content);
          }
          break;
        }
        case "tool_execution_end": {
          // 把工具结果文本带出来（dsh ToolRow OUT 卡）
          const res = (ev as { result?: { content?: { type?: string; text?: string }[] } }).result;
          const resultText = (res?.content ?? [])
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("");
          onEvent({
            type: "tool.complete",
            sessionId,
            tool: {
              id: String(ev.toolCallId ?? ""),
              name: "",
              status: ev.isError ? "error" : "completed",
              ...(resultText ? { result: resultText } : {}),
            },
          });
          break;
        }
        case "message_end":
          if (typeof ev.engineMessageId === "string" && ev.engineMessageId) {
            pendingEngineId = ev.engineMessageId;
          }
          if (typeof ev.message === "object" && ev.message?.stopReason === "error" && !errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId,
              messageId: msgId,
              message: String(ev.message.errorMessage ?? "引擎错误"),
            });
            started = false;
          }
          break;
        case "error":
          if (!errorSent) {
            errorSent = true;
            onEvent({
              type: "message.error",
              sessionId,
              messageId: msgId,
              code: String(ev.code ?? ""),
              retryable: Boolean(ev.retryable),
              message: typeof ev.message === "string" ? ev.message : String(ev.code ?? "引擎错误"),
            });
            started = false;
          }
          break;
        case "agent_end":
        case "done":
          if (started) {
            onEvent({
              type: "message.complete",
              sessionId,
              messageId: msgId,
              text: acc,
              ...(pendingEngineId ? { engineMessageId: pendingEngineId } : {}),
            });
            started = false;
          }
          pendingEngineId = "";
          break;
        case "usage":
          // token 计量 → 使用统计 store
          recordUsage(
            (ev as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; reasoningTokens?: number } }).usage ?? {},
          );
          break;
        case "subagent.started": {
          const p = (ev as unknown as { params?: Record<string, unknown> }).params ?? {};
          addSubagent(
            p.name ? String(p.name) : String(p.childSessionId ?? "subagent"),
            p.goal ? String(p.goal) : "",
            p.model ? String(p.model) : "",
            p.childSessionId ? String(p.childSessionId) : undefined,
          );
          break;
        }
        case "subagent.finished": {
          const p = (ev as unknown as { params?: Record<string, unknown> }).params ?? {};
          const id = String(p.childSessionId ?? "");
          if (id) updateSubagentStatus(id, "completed");
          break;
        }
        case "compaction_summary": {
          const p = (ev as { payload?: { count?: number; tokens?: number; summary?: string } }).payload;
          onEvent({
            type: "compaction.summary",
            sessionId,
            info: {
              count: typeof p?.count === "number" ? p.count : 0,
              tokens: typeof p?.tokens === "number" ? p.tokens : 0,
              ...(p?.summary ? { summary: p.summary } : {}),
            },
          });
          break;
        }
        case "user_question": {
          // 引擎 ask_user_question → 提问卡（前端渲染 + 回答经 question/resolve 回传）
          const p = (ev as { params?: { rpcId?: string; questions?: unknown[] } }).params ?? {};
          const questions = Array.isArray(p.questions)
            ? (p.questions as {
                id?: string;
                question?: string;
                detail?: string;
                header?: string;
                options?: { label?: string; description?: string }[];
                multiSelect?: boolean;
              }[]).map((q) => ({
                id: String(q.id ?? ""),
                question: String(q.question ?? ""),
                ...(q.detail ? { detail: q.detail } : {}),
                ...(q.header ? { header: q.header } : {}),
                ...(Array.isArray(q.options) && q.options.length > 0
                  ? {
                      options: q.options.map((o) => ({
                        label: String(o.label ?? ""),
                        ...(o.description ? { description: o.description } : {}),
                      })),
                    }
                  : {}),
                ...(q.multiSelect !== undefined ? { multiSelect: q.multiSelect } : {}),
              }))
            : [];
          if (p.rpcId && questions.length > 0) {
            onEvent({
              type: "user_question",
              sessionId,
              rpcId: p.rpcId,
              // 与 zosma 桥同标准：无 id/question 的畸形条目与空 label 选项一律滤掉，
              // 否则会弹出空白提问卡且无法作答
              questions: questions.filter((q) => q.id && q.question).map((q) => ({
                ...q,
                ...(q.options ? { options: q.options.filter((o) => o.label) } : {}),
              })),
            });
          }
          break;
        }
      }
    };
    // 引擎未就绪（启动门假阴性/断线）时 prewarm 后重试一次，而不是静默失败：
    // 对齐 hermes liveness 语义——失败必须可见（message.error → 聊天区系统消息
    // + 重试条 + busy 释放，handleMirachEvent 已有承接）。
    const { ensureEngineAlive } = await import("@/store/gateway");
    if (!(await ensureEngineAlive())) {
      onEvent({
        type: "message.error",
        sessionId,
        message: "引擎未就绪（正在自动重连，稍后重发即可）",
      });
      return;
    }
    try {
      await invoke("send_prompt", { text, ch, provider, model });
    } catch (err) {
      onEvent({ type: "message.error", sessionId, message: String(err) });
    }
  }

  /** 模型目录（dsh 单核心：sidecar catalog = 内置 deepseek + 设置页配置的提供商） */
  async getModels(): Promise<ModelOption[]> {
    return this.getDSHModels();
  }

  /** dsh 引擎模型目录（sidecar catalog()：内置 deepseek + 设置页配置的提供商） */
  async getDSHModels(): Promise<ModelOption[]> {
    try {
      const raw = await invoke<unknown>("get_models");
      const list = Array.isArray(raw) ? raw : [];
      return list.map((m) => {
        const o = m as Record<string, unknown>;
        return {
          id: String(o.id ?? ""),
          provider: String(o.provider ?? "deepseek"),
          label: String(o.name ?? o.id ?? ""),
        };
      });
    } catch {
      return [];
    }
  }

  /** 引擎插件清单（sidecar 生成 cordis.yml 的装配镜像，config.pluginEntries 走 stdin 通道） */
  async listEnginePlugins(): Promise<{ id: string; name: string }[]> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "config.pluginEntries", params: null });
      const entries = ((raw as { entries?: unknown[] } | null)?.entries ?? []) as { id: string; name: string }[];
      return entries
        .filter((e) => e && typeof e.id === "string")
        .map((e) => ({ id: String(e.id), name: String(e.name ?? "") }));
    } catch {
      return [];
    }
  }

  /** 社区插件清单（dsh-plugins 目录扫描 + 激活状态） */
  async listCommunityPlugins(): Promise<InstalledPluginInfo[]> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.list", params: null });
      return ((raw as { plugins?: InstalledPluginInfo[] } | null)?.plugins ?? []).filter((p) => p && p.name);
    } catch {
      return [];
    }
  }

  /** 安装社区插件（npm 装 dsh-plugins → junction → patch 追加；返回步骤日志） */
  async installCommunityPlugin(name: string): Promise<string[]> {
    const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.install", params: { name } });
    return ((raw as { logs?: string[] } | null)?.logs ?? []).map(String);
  }

  /** 卸载社区插件（patch 移除 → junction 删除 → npm uninstall；返回步骤日志） */
  async uninstallCommunityPlugin(name: string): Promise<string[]> {
    const raw = await invoke<unknown>("dsh_rpc", { method: "plugins.uninstall", params: { name } });
    return ((raw as { logs?: string[] } | null)?.logs ?? []).map(String);
  }

  /** 消息反馈上报（dsh messageFeedback.put，sidecar 通用 rpc 透传；
   *  sessionId 传前端会话 id，sidecar 映射到 dsh 会话 id） */
  async sendMessageFeedback(messageId: string, rating: "positive" | "negative"): Promise<boolean> {
    try {
      const { $activeSessionId } = await import("@/store/session");
      const res = await invoke<unknown>("dsh_rpc", {
        method: "messageFeedback.put",
        params: { sessionId: $activeSessionId.get(), messageId, rating },
      });
      return Boolean((res as { ok?: boolean } | null)?.ok);
    } catch {
      return false;
    }
  }

  /** 绑定酒馆预设到空白会话（agentPresets.select，sidecar 透传；锁定的会话返回 false） */
  async selectAgentPreset(sessionId: string, presetId: string): Promise<boolean> {
    try {
      await invoke("dsh_rpc", {
        method: "agentPresets.select",
        params: { sessionId, agentPreset: presetId },
      });
      return true;
    } catch {
      // 会话已有回合（locked）/ 预设不存在：绑定失败
      return false;
    }
  }

  /** 官方模型目录（session.modelCatalog；sidecar 直通，无会话 id） */
  async getNativeModelCatalog(): Promise<NativeModelCatalog | null> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "session.modelCatalog", params: {} });
      const cat = raw as NativeModelCatalog | null;
      if (!cat || !Array.isArray(cat.groups)) return null;
      return cat;
    } catch {
      return null; // 内核未装 session-controller remote / 引擎未启动
    }
  }

  /** 官方会话选型（session.selectModel；sidecar 通用映射：前端 id → dsh id） */
  async nativeSelectModel(sessionId: string, provider: string, model: string, reasoningEffort?: string): Promise<boolean> {
    try {
      await invoke("dsh_rpc", {
        method: "session.selectModel",
        params: { sessionId, provider, model, ...(reasoningEffort ? { reasoningEffort } : {}) },
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 官方斜杠命令执行（commands.execute；sidecar 映射 + 对象/位置编码回退） */
  async nativeExecuteCommand(sessionId: string, line: string): Promise<boolean> {
    try {
      await invoke("dsh_rpc", { method: "commands.execute", params: { sessionId, line } });
      return true;
    } catch {
      return false;
    }
  }

  /** 官方设置描述（settings.describe 直通；sidecar 无会话 id） */
  async describeSettings(): Promise<{ namespaces: { ns: string; schema: unknown; value: unknown }[] } | null> {
    try {
      const raw = await invoke<unknown>("dsh_rpc", { method: "settings.describe", params: {} });
      const desc = raw as { namespaces?: { ns: string; schema: unknown; value: unknown }[] } | null;
      const namespaces = desc?.namespaces;
      if (!Array.isArray(namespaces)) return null;
      return { namespaces: namespaces.filter((n) => n && typeof n.ns === "string") };
    } catch {
      return null;
    }
  }

  /** 前端会话 id → dsh 会话 id（sidecar session.map.get） */
  async getDshSessionId(sessionId: string): Promise<string | null> {
    try {
      const raw = await invoke<{ dshId?: string | null }>("dsh_rpc", { method: "session.map.get", params: { sessionId } });
      return raw?.dshId ?? null;
    } catch {
      return null;
    }
  }

  async checkEngineUpdate(): Promise<{ current: string; latest: string; hasUpdate: boolean }> {
    const raw = await invoke<{ current: string; latest: string; hasUpdate: boolean }>("dsh_rpc", { method: "update.check", params: null });
    return raw ?? { current: "", latest: "", hasUpdate: false };
  }

  async updateEngine(): Promise<string[]> {
    const raw = await invoke<unknown>("dsh_rpc", { method: "update.engine", params: null });
    return ((raw as { logs?: string[] } | null)?.logs ?? []).map(String);
  }

  subscribe(onEvent: (e: MirachEvent) => void): () => void {
    // dsh 通道的回复经 submitPromptStream 的 onEvent 回调逐条送达，
    // 这里保留订阅口（供上层统一挂事件处理器）；当前无服务端推送事件源。
    this.listeners.add(onEvent);
    return () => this.listeners.delete(onEvent);
  }
}

// ================================================================
// 单例出口
// ================================================================

export function createClient(mock: boolean): MirachClient {
  return mock ? new MockClient() : new RealClient();
}
