/**
 * MemberChatPanel — 子内容区（单个成员对话，固定会话 + 共享项目上下文）
 *
 * 排版完全复制主内容区（MainPanel）：
 * Header 85px（成员名 + 简介 + 关闭按钮）→ 对话内容区（消息列表 + 项目上下文徽标）
 * → 输入框 → 终端（独立 pty 实例，id 由全局分配器保证唯一）
 *
 * 会话由 AppLayout 管理（sessions: Record<memberId, MemberSession>），
 * 切换成员历史不丢失；发送消息通过 onSend 回调交给 AppLayout。
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HeaderRule } from "@/components/layout/HeaderRule";
import { Clock, Copy, Loader2, RefreshCw } from "lucide-react";
import { Composer } from "@/components/chat/Composer";
import { TerminalPanel } from "@/components/chat/TerminalPanel";
import { ResizeHandle } from "@/components/ui/ResizeHandle";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import type { ConvItem } from "@/components/layout/LeftSidebar";
import type { ChatMessage } from "@/lib/memberSessions";

const MIN_TERMINAL = 150;
const MAX_TERMINAL = 533;

// ── 酒馆式输出解析（对齐 dsh-tavern client 的两种美化） ──

interface ParsedTavernText {
  main: string;
  /** 「状态栏：」块（紫色状态卡渲染） */
  status?: string;
  /** 结尾剧情选项（"接下来你想怎么做？" + 1.2.3.）→ 可点击按钮 */
  options?: string[];
}

/** 解析成员回复：状态栏块 + 结尾剧情选项块（有则从正文剥离单独渲染） */
function parseTavernText(text: string): ParsedTavernText {
  let main = text;
  let status: string | undefined;
  let options: string[] | undefined;
  const sb = /(?:^|\n)状态栏[：:][ \t]*\n?([\s\S]*?)(?=\n\s*\n|$)/.exec(main);
  if (sb) {
    status = sb[1]!.trim();
    main = (main.slice(0, sb.index) + main.slice(sb.index + sb[0].length)).trim();
  }
  const opt = /接下来你想怎么做？\s*\n\s*1[.、．]\s*(.+)\n\s*2[.、．]\s*(.+)\n\s*3[.、．]\s*(.+)\s*$/.exec(main);
  if (opt) {
    options = [opt[1]!.trim(), opt[2]!.trim(), opt[3]!.trim()];
    main = main.slice(0, opt.index).trim();
  }
  return { main, status, options };
}

/** 状态栏紫色卡片（日期/时间/地点/用户列表等，逐行渲染） */
function StatusCard({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim());
  return (
    <div className="mt-2 rounded-xl border border-[#8B5CF6]/30 bg-[#8B5CF6]/8 px-3 py-2">
      <p className="text-[10px] font-semibold tracking-wide text-[#8B5CF6]">状态栏</p>
      <div className="mt-1 space-y-0.5">
        {lines.map((line, i) => (
          <p key={i} className="text-[11px] leading-relaxed text-[#4C1D95]">
            {line.trim()}
          </p>
        ))}
      </div>
    </div>
  );
}

interface MemberChatPanelProps {
  member: ConvItem;
  /** 子对话栏宽度（px 数字或 CSS 变量，默认 380，可拖拽调节） */
  width?: number | string;
  /** 该成员线程的消息列表（归属项目固定会话） */
  messages: ChatMessage[];
  /** 该成员是否正在等引擎回复（真实模式流式中显示"正在回复"提示） */
  busy?: boolean;
  /** 点击标题栏文字关闭子对话栏 */
  onClose: () => void;
  onSend: (memberId: string, text: string) => void;
}

export function MemberChatPanel({ member, width = 380, messages, busy = false, onClose, onSend }: MemberChatPanelProps) {
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalH, setTerminalH] = useState(MIN_TERMINAL);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);

  // 内容可滚动时上下边缘渐变淡出（与主内容区一致）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 自动跟随最新消息：用户停留在底部附近时，新消息自动滚动到底
  const nearBottomRef = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !nearBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const handleBodyScroll = () => {
    const el = bodyRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    nearBottomRef.current = max - el.scrollTop < 40;
  };

  return (
    <aside
      className="flex shrink-0 flex-col bg-white pb-5 animate-[fade-in_0.2s_ease-out]"
      // 标签字（成员名+简介）放在顶部，与主面板标题同一水平线
      style={{ width }}
    >
      {/* ---- Header 85px：成员名（点击关闭，效果同左侧栏标题切换）+ 简介 ---- */}
      <div
        className="relative flex shrink-0 items-center px-5"
        style={{ height: 85 }}
      >
        <HeaderRule />
        <div className="flex min-w-0 flex-col gap-1">
          <button
            onClick={onClose}
            title="点击关闭对话"
            // self-start：flex 列默认拉伸，会让整行都可点关闭；收缩到文字宽度
            // relative z-20：顶栏是拖拽区（z-10），标题要浮在其上保持可点击
            className="relative z-20 max-w-[230px] self-start truncate text-left text-heading font-bold text-[#303030] leading-[1.4] hover:opacity-80 transition-opacity"
          >
            {member.name}
          </button>
          <p
            title={member.desc}
            className="max-w-[230px] truncate text-body-sm text-muted-foreground leading-none"
          >
            {member.desc}
          </p>
        </div>
      </div>

      {/* ---- 对话内容区（固定会话消息列表） ---- */}
      <div
        ref={bodyRef}
        onScroll={handleBodyScroll}
        className="group min-h-[150px] flex-1 shrink-0 overflow-y-auto px-5 py-4"
        style={{
          maskImage: scrollable
            ? "linear-gradient(to bottom, transparent 0px, black 12px, black calc(100% - 12px), transparent 100%)"
            : undefined,
        }}
      >
            {/* 消息列表：限宽居中（与主对话区一致，参考 zosma 820px）——拖宽时内容不再撑满 */}
            <div className="mx-auto w-full max-w-[820px] space-y-4">
              {messages.map((m) =>
                m.role === "member" ? (
                  /* 成员消息：左侧成员头像 + 名字/时间 + 白色气泡（酒馆式输出：
                     状态栏块 → 紫色状态卡；结尾剧情选项 → 可点击按钮） */
                  <div key={m.id} className="flex gap-3">
                    <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                      <div
                        className="flex h-full w-full items-center justify-center rounded-full text-white text-[10px] font-bold"
                        style={{ backgroundColor: member.avatarBg }}
                      >
                        {member.initials}
                      </div>
                      <span
                        className="absolute block rounded-full border-2 border-white"
                        style={{
                          width: 11,
                          height: 11,
                          bottom: -1,
                          right: -1,
                          backgroundColor: member.status === "pending" ? "#D1D5DB" : "#10B981",
                        }}
                      />
                    </div>
                    {(() => {
                      const parsed = parseTavernText(m.text);
                      return (
                        <div className="min-w-0 flex-1">
                          <div className="mb-2 flex items-center gap-2">
                            <span className="text-member font-medium text-[#303030]">{member.name}</span>
                            <span className="text-body-sm text-muted-foreground">{m.time}</span>
                          </div>
                          <div className="break-words rounded-lg rounded-tl-none border border-black/10 bg-white px-4 py-3">
                            <div className="text-body-sm leading-relaxed text-[#303030]">
                              <MarkdownText content={parsed.main} />
                            </div>
                          </div>
                          {parsed.status && <StatusCard text={parsed.status} />}
                          {parsed.options && parsed.options.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <p className="text-[10px] text-muted-foreground">剧情选项（点击发送）</p>
                              {parsed.options.map((o, i) => (
                                <button
                                  key={i}
                                  onClick={() => onSend(member.id, o)}
                                  className="block w-full rounded-lg border border-[#8B5CF6]/30 bg-white px-3 py-1.5 text-left text-[12px] text-[#303030] transition-colors hover:border-[#8B5CF6] hover:bg-[#8B5CF6]/5"
                                >
                                  <span className="mr-1.5 font-semibold text-[#8B5CF6]">{i + 1}.</span>
                                  {o}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  /* 用户消息：右侧名字 + 浅蓝气泡 + ME 头像 */
                  <div key={m.id} className="flex justify-end gap-3">
                    <div className="max-w-[70%] min-w-0">
                      <div className="mb-2 flex items-center justify-end">
                        <span className="text-member font-medium text-[#303030]">用户01</span>
                      </div>
                      <div className="break-words rounded-lg rounded-tr-none border border-black/10 bg-[#D2DAEC] px-4 py-3">
                        <div className="text-body-sm leading-relaxed text-[#303030]">
                          <MarkdownText content={m.text} />
                        </div>
                      </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: 40, height: 40 }}>
                      <div className="flex h-full w-full items-center justify-center rounded-full bg-[#303030] text-white text-sm font-bold">
                        ME
                      </div>
                      <span
                        className="absolute block rounded-full border-2 border-white"
                        style={{ width: 11, height: 11, bottom: -1, right: -1, backgroundColor: "#10B981" }}
                      />
                    </div>
                  </div>
                ),
              )}
              {/* 等待指示：真实模式引擎回复中（流式首包前/思考阶段） */}
              {busy && (
                <div className="flex items-center gap-2 pl-1 text-[11px] text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin text-[#017CF3]" />
                  {member.name} 正在回复…
                </div>
              )}
            </div>

            {/* 悬停操作栏 */}
            <div className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {[
                { icon: Clock, label: "2分钟前", clickable: false },
                { icon: Copy, label: "复制", clickable: true },
                            { icon: RefreshCw, label: "重试", clickable: true },
              ].map((act, i) => (
                <button
                  key={i}
                  disabled={!act.clickable}
                  className={cn(
                    "flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors",
                    act.clickable
                      ? "cursor-pointer text-muted-foreground hover:bg-muted hover:text-[#303030]"
                      : "cursor-default text-muted-foreground/60",
                  )}
                  title={act.label}
                >
                  <act.icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {i === 0 && <span>{act.label}</span>}
                </button>
              ))}
            </div>
      </div>

      {/* ---- 输入框（发送交给 AppLayout 管理会话） ---- */}
      <Composer
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen((v) => !v)}
        onSend={(text) => onSend(member.id, text)}
      />

      {/* ---- 终端（独立 pty 实例） ---- */}
      <ResizeHandle
        onDrag={(dy) =>
          setTerminalH((h) => Math.max(MIN_TERMINAL, Math.min(h - dy, MAX_TERMINAL)))
        }
      />
      {terminalOpen && (
        <TerminalPanel
          height={terminalH}
          onClose={() => setTerminalOpen(false)}
        />
      )}
    </aside>
  );
}
