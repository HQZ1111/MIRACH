/**
 * chat-history - 聊天记录弹窗数据模型与状态（微信"查找聊天记录"样式）
 *
 * 搜索当前会话：对话 / 图片 / 文件 / 链接 产物，按标签页筛选 + 日历选日期看当天。
 * mock 模式为 400 条消息合成日期（铺到最近 30 天）与图片/文件示例；
 * 真实模式图片从 tool-calls 的 image_generate 解析、日期=当天。
 * 跳转：条目的 messageIndex = 会话消息数组下标（与 ChatSection 同一消息源），
 * 点结果 → requestJump → ChatSection 滚动+闪烁定位。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";
import { $activeSessionId } from "@/store/session";
import { getSessionChat } from "@/store/session-chat";
import { $liveMessages } from "@/store/chat";
import { $toolCalls } from "@/store/tool-calls";
import { detectArtifacts } from "@/lib/artifact-detect";
import { $sessions } from "@/store/sessions";
import { parseGeneratedImage } from "@/lib/generated-images";

export type ChatRecordType = "chat" | "image" | "file" | "link";

export interface ChatRecordEntry {
  id: string;
  sessionId: string;
  type: ChatRecordType;
  role: string;
  text: string;
  time: string;
  /** yyyy-MM-dd */
  date: string;
  /** 当天 0 点 ms（排序/日历用） */
  dayMs: number;
  /** 对话条目在会话消息数组的索引（跳转用；非对话条目为 -1） */
  messageIndex: number;
  image?: { url: string; aspectRatio: string | null };
  file?: { name: string; size: string; kind: string };
  link?: { url: string };
}

// ----------------------------------------------------------------
// 弹窗 / 标签页 / 跳转 状态
// ----------------------------------------------------------------

export const $chatHistoryOpen = atom(false);
export function openChatHistory(): void {
  $chatHistoryOpen.set(true);
}
export function closeChatHistory(): void {
  $chatHistoryOpen.set(false);
}

/** 主对话栏上方的会话标签条是否显示（工具按钮可隐藏） */
export const $showSessionTabs = atom(true);
export function toggleSessionTabs(): void {
  $showSessionTabs.set(!$showSessionTabs.get());
}

/** 跳转请求：弹窗点结果 → 设消息索引 → ChatSection 监听滚动+闪烁 */
export const $jumpRequest = atom<number | null>(null);
export function requestJump(messageIndex: number): void {
  $jumpRequest.set(messageIndex);
}

/** 轨迹弹窗请求：左侧栏「查看调用轨迹」→ MainPanel 监听打开 TrajectoryOverlay */
export const $trajectoryRequest = atom(0);
export function requestTrajectory(): void {
  $trajectoryRequest.set($trajectoryRequest.get() + 1);
}

// ----------------------------------------------------------------
// 数据构建（当前会话）
// ----------------------------------------------------------------

let idSeq = 0;
const nid = (p: string) => `${p}${Date.now()}_${idSeq++}`;

function fmtDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayStartMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** mock 合成图片（SVG 渐变 dataURL 占位） */
function mockImageUrl(seed: number): string {
  const hue = (seed * 47) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue},70%,60%)"/>` +
    `<stop offset="1" stop-color="hsl(${(hue + 60) % 360},70%,45%)"/>` +
    `</linearGradient></defs><rect width="320" height="200" fill="url(#g)"/>` +
    `<text x="160" y="108" font-size="18" fill="rgba(255,255,255,0.9)" text-anchor="middle" font-family="sans-serif">生成图片 ${seed}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function titleOf(sessionId: string): string {
  return $sessions.get().find((s) => s.id === sessionId)?.title ?? "新会话";
}

/** 构建当前会话的聊天记录条目（含 mock 合成数据；调用方用 useMemo 缓存） */
export function buildChatRecords(): ChatRecordEntry[] {
  const sessionId = $activeSessionId.get();
  // 消息源与 ChatSection 一致（跳转索引才精确）
  const msgs = MOCK ? getSessionChat(sessionId, titleOf(sessionId)) : $liveMessages.get();
  const entries: ChatRecordEntry[] = [];
  const today = new Date();

  msgs.forEach((m, i) => {
    let date: Date;
    let time = m.time || "";
    if (MOCK) {
      // mock：按索引铺到最近 30 天（每天 ~14 条，日历上有消息的日期可点）
      const daysAgo = Math.min(29, Math.floor(i / 14));
      date = new Date(today);
      date.setDate(date.getDate() - daysAgo);
      if (!time) time = "09:" + String(i % 60).padStart(2, "0");
    } else {
      date = today;
      if (!time) time = "12:00";
    }
    const text = m.text ?? "";
    entries.push({
      id: nid("c"),
      sessionId,
      type: "chat",
      role: m.role,
      text,
      time,
      date: fmtDay(date),
      dayMs: dayStartMs(date),
      messageIndex: i,
    });
    // 消息里的链接 → link 产物（同日）
    for (const l of detectArtifacts(text).filter((a) => a.kind === "link")) {
      entries.push({
        id: nid("l"),
        sessionId,
        type: "link",
        role: m.role,
        text: l.title ?? "",
        time,
        date: fmtDay(date),
        dayMs: dayStartMs(date),
        messageIndex: i,
        link: { url: l.url ?? l.title },
      });
    }
  });

  // 图片：真实模式从 tool-calls 解析；mock 合成几条
  if (MOCK) {
    for (let k = 0; k < 5; k++) {
      const d = new Date(today);
      d.setDate(d.getDate() - ((k * 5) % 30));
      entries.push({
        id: nid("i"),
        sessionId,
        type: "image",
        role: "ai",
        text: `生成图片：风景插画 ${k + 1}`,
        time: `1${k}:2${k}`,
        date: fmtDay(d),
        dayMs: dayStartMs(d),
        messageIndex: -1,
        image: { url: mockImageUrl(k + 1), aspectRatio: "1" },
      });
    }
  } else {
    for (const tc of $toolCalls.get()) {
      if (tc.name === "image_generate" && tc.detail) {
        const img = parseGeneratedImage(tc.detail);
        if (img?.url) {
          entries.push({
            id: nid("i"),
            sessionId,
            type: "image",
            role: "ai",
            text: img.caption ?? tc.title ?? "生成图片",
            time: new Date(tc.startedAt).toTimeString().slice(0, 5),
            date: fmtDay(today),
            dayMs: dayStartMs(today),
            messageIndex: -1,
            image: { url: img.url, aspectRatio: img.aspectRatio },
          });
        }
      }
    }
  }

  // 文件：mock 合成；真实模式暂无来源（引擎产物流未接）
  if (MOCK) {
    const files: { name: string; size: string; kind: string }[] = [
      { name: "项目周报.pdf", size: "2.3 MB", kind: "pdf" },
      { name: "设计稿.png", size: "1.1 MB", kind: "image" },
      { name: "数据备份.zip", size: "8.6 MB", kind: "zip" },
      { name: "会议纪要.docx", size: "45 KB", kind: "doc" },
    ];
    files.forEach((f, k) => {
      const d = new Date(today);
      d.setDate(d.getDate() - ((k * 3 + 1) % 30));
      entries.push({
        id: nid("f"),
        sessionId,
        type: "file",
        role: "system",
        text: `文件：${f.name}`,
        time: `1${k}:4${k}`,
        date: fmtDay(d),
        dayMs: dayStartMs(d),
        messageIndex: -1,
        file: f,
      });
    });
  }

  // 排序：日期倒序（同日内保持消息原序，sort 稳定）
  entries.sort((a, b) => b.dayMs - a.dayMs);
  return entries;
}

/** 条目的可分享/转发文本 */
export function entryText(e: ChatRecordEntry): string {
  if (e.type === "image") return e.text;
  if (e.type === "file") return e.file ? `[文件] ${e.file.name} (${e.file.size})` : e.text;
  if (e.type === "link") return e.link?.url ?? e.text;
  return e.text;
}
