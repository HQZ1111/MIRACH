/**
 * ZosmaChat — 简约对话档适配器（对话风格 = 简约）
 *
 * 把 zosma 的 ChatView 组件树接进 my-hermes-rs 主面板：
 * - 历史消息：MOCK 模式读 per-session store（$sessionChat），真实模式读 $liveMessages；
 * - 流式状态机：useDSHStream 消费 dsh 事件适配层输出的流式事件
 *   （sidecar 把 dsh session.event 映射成组件消费的形状，此处不改组件只换数据入口）；
 * - MOCK 模式不走 invoke，用 dispatch 直接驱动 reducer，模拟「思考 → 打字回复」，
 *   完成后写回会话 store（左侧栏预览/切换后仍可见）；
 * - 深色模式：my-hermes-rs 用 html.dark（minimal.css 已做选择器转换）。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useStore } from "@nanostores/react";
import { invoke } from "@tauri-apps/api/core";
import { LanguageProvider } from "@/components/zosma/contexts/LanguageContext";
import { ChatView } from "@/components/zosma/ChatView";
import { Composer } from "@/components/chat/Composer";
import { useDSHStream } from "@/components/zosma/hooks/useDSHStream";
import {
  BUILTIN_COMMANDS,
  findBuiltinCommand,
  runBuiltinCommand,
  type CommandContext,
} from "@/components/zosma/lib/builtinCommands";
import type { ChatMessage } from "@/components/zosma/types";
import { MOCK } from "@/lib/mock";
import { $providerConfig } from "@/store/providerConfig";
import { $liveMessages, newTaskSession, type LiveChatMessage } from "@/store/chat";
import { $toolCalls } from "@/store/tool-calls";
import { $sessionChat, getSessionChat, appendSessionUserMessage, appendSessionAiMessage } from "@/store/session-chat";
import { setActiveSession } from "@/store/session";

/** 打开设置浮层（AppLayout 监听该事件并切换到 general 分区） */
export const OPEN_SETTINGS_EVENT = "mirach:open-settings";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** MOCK 演示回复：一段带 Markdown 结构的固定回复（演示流式打字效果） */
function buildMockReply(prompt: string): string {
  const topic = prompt.trim().slice(0, 40) || "这个任务";
  return `收到，我来处理「${topic}」。

## 处理思路

- 先梳理需求与现状
- 定位相关代码/资料
- 给出可落地的方案

## 结果

已完成初步分析，改动集中在几个关键文件，并补充了必要的测试用例。如需要调整范围或换一种实现方式，随时告诉我。

> 这是简约对话档的演示回复（MOCK 模式），真实对话由 dsh 引擎驱动。`;
}

interface ZosmaChatProps {
  /** 当前活跃会话 id（左栏会话；简约档历史消息按会话隔离） */
  sessionId: string;
  /** 会话标题（MOCK 惰性生成带主题对话用） */
  sessionTitle: string;
}

export function ZosmaChat({ sessionId, sessionTitle }: ZosmaChatProps) {
  const {
    state: streamState,
    startStream,
    abortStream,
    steerStream,
    followUpStream,
    clearQueue,
    dispatch,
  } = useDSHStream();
  const isRunning = streamState.isRunning;

  // 消息源：mock 按会话隔离（与主面板一致）；真实模式由 useDSHStream reducer 累积
  //（dsh 事件流自含完整会话，不混入 hermes 引擎的 $liveMessages）
  const chatMap = useStore($sessionChat);
  const msgs = MOCK ? (chatMap.get(sessionId) ?? getSessionChat(sessionId, sessionTitle)) : [];

  // 会话 store 消息 → zosma ChatMessage（气泡/时间戳）
  const history = useMemo<ChatMessage[]>(() => {
    const list = Array.isArray(msgs) ? msgs : [];
    return list
      .filter((m) => m.role === "user" || m.role === "ai")
      .map((m, i) => ({
        id: (m as { id?: string }).id ?? `store-${sessionId}-${i}`,
        role: m.role === "ai" ? "assistant" : "user",
        content: m.text,
        timestamp: Date.now() - (list.length - i) * 1000,
      }));
  }, [msgs, sessionId]);

  // 真实模式：$liveMessages 是 dsh 会话的统一共享 store（两风格都写它/读它，
  // 切换对话风格不丢对话）；转成 zosma ChatMessage 形状（思考 + 工具时间线）
  const live = useStore($liveMessages);
  const toolCalls = useStore($toolCalls);
  const liveHistory = useMemo<ChatMessage[]>(() => {
    const list = Array.isArray(live) ? live : [];
    const lastAiIdx = list.map((m) => m.role).lastIndexOf("ai");
    return list
      .filter((m) => m.role === "user" || m.role === "ai")
      .map((m, i) => {
        const orig = m as LiveChatMessage;
        const isLastAi = m.role === "ai" && i === lastAiIdx;
        return {
          id: m.id ?? `live-${i}`,
          role: m.role === "ai" ? "assistant" : "user",
          content: m.text,
          timestamp: Date.now() - (list.length - i) * 1000,
          ...(orig.thinking ? { thinking: orig.thinking } : {}),
          // 流式中：bridge（$liveMessages）已实时更新，streamingMessage 不再
          // 重复渲染（避免一条回复两个气泡）；最后一条 AI 打流式标记保动画
          ...(isLastAi && isRunning ? { isStreaming: true } : {}),
          // 工具调用挂到最新一条 AI 消息（$toolCalls 无消息关联，按当前回合聚合展示）
          ...(isLastAi && toolCalls.length > 0
            ? {
                toolCalls: toolCalls.map((c) => ({
                  id: c.id,
                  name: c.name,
                  args: {},
                  status: c.status === "completed" ? ("completed" as const) : c.status === "error" ? ("error" as const) : ("running" as const),
                })),
              }
            : {}),
        };
      });
  }, [live, toolCalls, isRunning]);

  // MOCK 流式模拟取消令牌：切换会话 / 停止时使循环退出
  const runIdRef = useRef(0);

  // 切换会话：非运行中清掉上一会话的流式残留（消息/错误/队列）
  useEffect(() => {
    if (!streamState.isRunning) dispatch({ type: "RESET" });
    runIdRef.current++;
    // Phase 5：真实模式把左栏会话 id 映射为 dsh sessionId —
    // 新会话自动建、历史会话续聊（dsh 持久化在 session store）。
    if (!MOCK) {
      invoke("load_dsh_session", { sessionId }).catch((err) =>
        console.warn("[zosma] load_dsh_session:", err),
      );
      // 同步设置页 providerConfig（自定义端点/模型/API key）给 sidecar：
      // 目录合并 + 端点/key 注入 runtime env（切换会话/重挂载时保持最新）
      invoke("sync_provider_config", { configs: $providerConfig.get() }).catch((err) =>
        console.warn("[zosma] sync_provider_config:", err),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 简约档输入框 = 默认 Composer 套 zosma 玻璃样式（glass 只换外壳 ui，不换图标/逻辑）：
  // 三种对话风格的输入框是同一个组件，切换风格时输入框按钮保持不变。
  // Composer 内部自管发送与 $agentBusy（mock：追加消息 + 2.5s 忙碌；真实：流式提交）。

  // MOCK 发送：直接驱动 reducer 模拟「思考 → 打字回复」，完成写回会话 store
  const mockSend = useCallback(
    async (text: string) => {
      const runId = ++runIdRef.current;
      appendSessionUserMessage(sessionId, text);
      dispatch({ type: "START_STREAM", prompt: text });

      const thinking = "让我分析一下这个问题…\n1. 理解需求\n2. 检索相关信息\n3. 组织回答";
      for (const ch of thinking) {
        if (runIdRef.current !== runId) return;
        dispatch({ type: "THINKING_DELTA", delta: ch });
        await sleep(10);
      }
      const reply = buildMockReply(text);
      for (let i = 0; i < reply.length; i += 2) {
        if (runIdRef.current !== runId) return;
        dispatch({ type: "TEXT_DELTA", delta: reply.slice(i, i + 2) });
        await sleep(14);
      }
      if (runIdRef.current !== runId) return;
      dispatch({ type: "STREAM_COMPLETE" });
      appendSessionAiMessage(sessionId, reply);
    },
    [sessionId, dispatch],
  );

  const handleSend = useCallback(
    async (text: string) => {
      if (MOCK) {
        await mockSend(text);
        return;
      }
      await startStream(text);
    },
    [mockSend, startStream],
  );

  const handleAbort = useCallback(() => {
    runIdRef.current++; // MOCK：终止模拟循环
    abortStream();
  }, [abortStream]);

  const handleSteer = useCallback(
    async (text: string) => {
      if (MOCK) {
        dispatch({ type: "QUEUE_OPTIMISTIC", kind: "steer", text });
        return;
      }
      await steerStream(text);
    },
    [MOCK, dispatch, steerStream],
  );

  const handleFollowUp = useCallback(
    async (text: string) => {
      if (MOCK) {
        dispatch({ type: "QUEUE_OPTIMISTIC", kind: "follow_up", text });
        return;
      }
      await followUpStream(text);
    },
    [MOCK, dispatch, followUpStream],
  );

  const handleEditQueue = useCallback(async () => {
    if (MOCK) {
      dispatch({ type: "QUEUE_UPDATE", steering: [], followUp: [] });
      return;
    }
    await clearQueue();
  }, [MOCK, dispatch, clearQueue]);

  const handleRetry = useCallback(() => {
    // 真实模式 history 恒空（仅 MOCK）：从 $liveMessages 取最后一条用户消息重发
    const lastUser = MOCK
      ? [...history].reverse().find((m) => m.role === "user")
      : [...live].reverse().find((m) => m.role === "user");
    const content = lastUser
      ? MOCK
        ? (lastUser as { content: string }).content
        : (lastUser as LiveChatMessage).text
      : null;
    if (content) void handleSend(content);
  }, [history, live, handleSend]);

  // 斜杠命令上下文（命令面板注册表是 zosma 原样移植；动作桥接回 my-hermes-rs）
  const commandCtx: CommandContext = useMemo(
    () => ({
      newSession: () => {
        setActiveSession(newTaskSession());
      },
      openSessions: () => {
        /* 左侧栏常驻会话列表，无需动作 */
      },
      openModelSelector: () => {
        /* 简约档暂不接模型选择器（Phase 4 接 dsh 模型配置） */
      },
      openSettings: () => {
        window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
      },
      showHelp: () => {
        /* 命令列表已由 /help 文档覆盖，暂不弹帮助 */
      },
    }),
    [],
  );

  const handleRunCommand = useCallback(
    (cmd: { name: string }, args: string) => {
      const builtin = findBuiltinCommand(cmd.name);
      if (!builtin) return;
      runBuiltinCommand(commandCtx, builtin, args);
    },
    [commandCtx],
  );

  return (
    <LanguageProvider>
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatView
          messages={MOCK ? history : liveHistory}
          // 真实模式：$liveMessages bridge 已实时渲染流式内容，streamingMessage
          // 不重复渲染（避免一条回复两个气泡）；MOCK 无 bridge，保留它
          streamingMessage={MOCK ? streamState.streamingMessage : null}
          isRunning={streamState.isRunning}
          error={streamState.error}
          onSend={handleSend}
          onAbort={handleAbort}
          onRetry={handleRetry}
          onSteer={handleSteer}
          onFollowUp={handleFollowUp}
          queue={streamState.queue}
          onEditQueue={handleEditQueue}
          sessionKey={sessionId}
          commands={BUILTIN_COMMANDS}
          onRunCommand={handleRunCommand}
          hideComposer
        />
        {/* 输入框 = 默认 Composer（glass 套 zosma 玻璃外壳；逻辑与其它风格一致）。
            接上 onSend → 走 dsh 流程（useDSHStream），避免发消息落到 hermes 引擎路径 */}
        <Composer glass onSend={handleSend} standalone />
      </div>
    </LanguageProvider>
  );
}
