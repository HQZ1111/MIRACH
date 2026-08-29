/**
 * ui-settings — 通用设置分区（设置页第一位）的持久化状态
 *
 * 对话宽度直接复用 zosma 移植的 chat-width lib（三档 820/1080/无限制）；
 * 对话风格（默认/dsh系统/简约）、繁忙时 Enter 行为、聊天背景、
 * Agent 预设均存 localStorage，这里统一以 atom 暴露，供设置页与对话区联动。
 */

import { atom } from "nanostores";
import { getChatWidth, setChatWidth as persistChatWidth, applyChatWidth, type ChatWidth } from "@/lib/chat-width";

export type ChatStyle = "default" | "dsh" | "minimal";
export type EnterBehavior = "queue" | "steer";
export type ChatBackdrop = "off" | "on";

const STYLES: ChatStyle[] = ["default", "dsh", "minimal"];
const BEHAVIORS: EnterBehavior[] = ["queue", "steer"];

function load<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* ignore */
  }
  return fallback;
}

// ----------------------------------------------------------------
// 对话宽度（zosma 三档；改动即持久化 + 应用 CSS 变量）
// ----------------------------------------------------------------

export const $chatWidth = atom<ChatWidth>(getChatWidth());

export function setChatWidth(width: ChatWidth): void {
  $chatWidth.set(width);
  persistChatWidth(width);
  applyChatWidth(width);
}

// ----------------------------------------------------------------
// 对话风格：default=现有 UI / dsh=现有 UI 紧凑行式 / minimal=zosma 组件树
// ----------------------------------------------------------------

export const $chatStyle = atom<ChatStyle>(load("mirach.chatStyle", "default", STYLES));

export function setChatStyle(style: ChatStyle): void {
  $chatStyle.set(style);
  try {
    localStorage.setItem("mirach.chatStyle", style);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------
// 繁忙时 Enter 键行为：queue=排队发送 / steer=插话发送（转向）
// ----------------------------------------------------------------

export const $enterBehavior = atom<EnterBehavior>(load("mirach.enterBehavior", "queue", BEHAVIORS));

export function setEnterBehavior(b: EnterBehavior): void {
  $enterBehavior.set(b);
  try {
    localStorage.setItem("mirach.enterBehavior", b);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------
// 聊天背景（对话风格之后）：关闭 / 开启
// ----------------------------------------------------------------

export const $chatBackdrop = atom<ChatBackdrop>(load("mirach.chatBackdrop", "off", ["off", "on"] as const));

export function setChatBackdrop(v: ChatBackdrop): void {
  $chatBackdrop.set(v);
  try {
    localStorage.setItem("mirach.chatBackdrop", v);
  } catch {
    /* ignore */
  }
}

// ----------------------------------------------------------------
// Agent 预设（默认智能体）：存 agent id
// ----------------------------------------------------------------

function loadDefaultAgent(): string {
  try {
    return localStorage.getItem("mirach.defaultAgent") ?? "";
  } catch {
    return "";
  }
}

export const $defaultAgent = atom<string>(loadDefaultAgent());

export function setDefaultAgent(id: string): void {
  $defaultAgent.set(id);
  try {
    localStorage.setItem("mirach.defaultAgent", id);
  } catch {
    /* ignore */
  }
}

/** 应用启动时一次性初始化（对话宽度 CSS 变量） */
export function initUiSettings(): void {
  applyChatWidth($chatWidth.get());
}
