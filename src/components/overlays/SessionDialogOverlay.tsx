/**
 * SessionDialogOverlay — 会话对话框（应用内弹窗）
 *
 * 「在新窗口打开」改为应用内对话框，外观与子对话栏（MemberChatPanel）完全一致：
 * 直接复用 MemberChatPanel（把会话包装成"成员"），Header / 消息气泡 / Composer /
 * 终端全部一致。外层为 fixed 居中浮层（遮罩点击 / Esc / 标题点击关闭）。
 *
 *  - 会话 id 为空 → 空白新会话（⌘⇧N）：延迟创建真实会话
 *  - 发送：Composer 会把用户消息写入当前活跃会话，因此打开对话框时把活跃会话
 *    切到本会话；模拟 AI 回复由本组件追加
 */

import { useEffect, useMemo, useState } from "react";import { useStore } from "@nanostores/react";
import { MemberChatPanel } from "@/components/chat/MemberChatPanel";
import { $sessionChat, getSessionChat, appendSessionAiMessage } from "@/store/session-chat";
import { $sessions, createSession } from "@/store/sessions";
import { setActiveSession } from "@/store/session";
import type { ConvItem } from "@/components/layout/LeftSidebar";
import type { ChatMessage } from "@/lib/memberSessions";

interface SessionDialogOverlayProps {
  /** 会话 id；null 表示空白新会话 */
  sessionId: string | null;
  onClose: () => void;
}

export function SessionDialogOverlay({ sessionId, onClose }: SessionDialogOverlayProps) {
  const sessions = useStore($sessions);
  const chatMap = useStore($sessionChat);
  const [draftId, setDraftId] = useState<string | null>(sessionId);

  // 解析标题（空白新会话先创建真实会话 id，标题「新会话」）。
  // 放 useEffect：useMemo 里的 createSession 是渲染副作用，StrictMode 下会重复建会话。
  const [resolvedId, setResolvedId] = useState<string>(sessionId ?? "");
  useEffect(() => {
    if (draftId) {
      setResolvedId(draftId);
      return;
    }
    const s = createSession();
    setDraftId(s.id);
    setResolvedId(s.id);
  }, [draftId]);

  const title = sessions.find((s) => s.id === resolvedId)?.title ?? "新会话";
  // 消息：mock 按会话隔离读取
  const msgs = useMemo(() => chatMap.get(resolvedId) ?? getSessionChat(resolvedId, title), [chatMap, resolvedId, title]);

  // 打开对话框时把活跃会话切到本会话（Composer 发送写入正确会话）
  useEffect(() => {
    setActiveSession(resolvedId);
  }, [resolvedId]);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // 会话包装为"成员"（子对话栏 ConvItem），initials 取标题前两位
  const member: ConvItem = useMemo(
    () => ({
      id: resolvedId,
      name: title,
      initials: (title.replace(/\s+/g, "").slice(0, 2) || "HM").toUpperCase(),
      avatarBg: "#303030",
      preview: "",
      desc: "会话对话",
      time: "",
      status: "generating",
      tab: "all",
    }),
    [resolvedId, title],
  );

  // 会话消息 → 子对话栏消息格式（ai/system → member，user → user）
  const messages: ChatMessage[] = useMemo(
    () =>
      msgs.map((m, i) => ({
        id: `${resolvedId}-${i}`,
        role: m.role === "user" ? "user" : "member",
        text: m.text,
        time: m.time,
      })),
    [msgs, resolvedId],
  );

  // 发送：用户消息已由 Composer 写入活跃会话（=本会话），这里只追加模拟 AI 回复
  const handleSend = (_memberId: string, text: string) => {
    window.setTimeout(() => {
      appendSessionAiMessage(resolvedId, `收到：「${text}」——（模拟回复）我记下了，稍后详细展开。`);
    }, 500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
      {/* 遮罩点击关闭 */}
      <div className="absolute inset-0" onClick={onClose} />
      {/* 面板：复用子对话栏，与 MemberChatPanel 外观一致 */}
      <div className="panel-glass popup-anim relative flex h-[640px] w-[820px] overflow-hidden rounded-2xl">
        <MemberChatPanel
          key={resolvedId}
          width="100%"
          member={member}
          messages={messages}
          onClose={onClose}
          onSend={handleSend}
        />
      </div>
    </div>
  );
}
