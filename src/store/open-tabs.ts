/**
 * open-tabs - 会话多标签 store（本地持久化）
 *
 * 会话标签 = 一组同时打开（"正在协作"）的会话，对应原型 ⌘T 标签/会话交换交互。
 * 标签本身只是打开状态：切换标签调 setActiveSession 驱动主对话区，
 * 会话数据与标题仍在 sessions store 中维护。
 *
 * 规则：
 *  - openTab / closeTab / reorderTabs 均持久化到 localStorage；
 *  - 关闭最后一个标签后置 $tabsDismissed，防止 SessionTabs 的自动补开
 *    逻辑立刻"复活"被用户主动关掉的标签；再次 openTab 时复位。
 */

import { atom } from "nanostores";
import { $sessions } from "@/store/sessions";

export interface OpenTab {
  id: string;
}

const STORAGE_KEY = "mirach.openTabs.v1";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as string[];
      if (Array.isArray(arr)) return arr.filter((x) => typeof x === "string");
    }
  } catch {
    /* 解析失败回退空 */
  }
  return [];
}

export const $openTabIds = atom<string[]>(load());

/** 用户关闭了最后一个标签（防止 auto-open 立刻复活被关的标签） */
export const $tabsDismissed = atom<boolean>(false);

/** 抑制下一次 auto-open：左栏普通点击 = in-place 切换（不开标签），
 *  SessionTabs 的自动补开 effect 消费后复位（⌘+点击等标签意图路径不受影响） */
export const $suppressTabOnce = atom<boolean>(false);

function persist(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* 存储失败忽略（隐私模式等） */
  }
}

function commit(ids: string[]): void {
  persist(ids);
  $openTabIds.set(ids);
}

/** 打开标签（已在列表中则无操作）；同时复位 dismissed */
export function openTab(id: string): void {
  const ids = $openTabIds.get();
  if (!ids.includes(id)) commit([...ids, id]);
  $tabsDismissed.set(false);
}

/** 关闭标签；返回建议激活的邻居 id（右侧优先，越界取末尾），全关返回 null */
export function closeTab(id: string): string | null {
  const ids = $openTabIds.get();
  const idx = ids.indexOf(id);
  if (idx === -1) return null;
  const next = ids.filter((x) => x !== id);
  commit(next);
  if (next.length === 0) $tabsDismissed.set(true);
  return next.length > 0 ? next[Math.min(idx, next.length - 1)] : null;
}

/** 拖拽排序：把 fromId 移到 toIndex（在去除 fromId 后的数组中的位置） */
export function reorderTabs(fromId: string, toIndex: number): void {
  const ids = $openTabIds.get();
  const from = ids.indexOf(fromId);
  if (from === -1) return;
  const next = [...ids];
  next.splice(from, 1);
  const clamped = Math.max(0, Math.min(toIndex, next.length));
  next.splice(clamped, 0, fromId);
  // 无变化（拖回原位）也走 commit：数组内容相同，persist 幂等，无需特判
  commit(next);
}

/** 会话标题查询（标签栏展示用；被删除的会话显示占位） */
export function tabTitle(id: string): string {
  return $sessions.get().find((s) => s.id === id)?.title ?? "新会话";
}
