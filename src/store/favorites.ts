/**
 * favorites - 消息收藏（微信"收藏"：存快照到 localStorage）
 *
 * 收藏的是条目快照（文本/图片/文件/链接），即使原消息被删除仍可查看。
 * 与 sessions.ts 相同的 load/persist/commit 模式。
 */

import { atom } from "nanostores";
import type { ChatRecordEntry } from "./chat-history";

export interface FavoriteRecord {
  id: string;
  sessionId: string;
  type: string;
  role: string;
  text: string;
  time: string;
  date: string;
  image?: { url: string; aspectRatio: string | null };
  file?: { name: string; size: string; kind: string };
  link?: { url: string };
  favoritedAt: number;
}

const KEY = "mirach.favorites.v1";

function load(): FavoriteRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as FavoriteRecord[];
  } catch {
    /* 解析失败回退空 */
  }
  return [];
}

function persist(list: FavoriteRecord[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* 存储失败忽略 */
  }
}

export const $favorites = atom<FavoriteRecord[]>(load());
const favIds = new Set($favorites.get().map((f) => f.id));

function commit(list: FavoriteRecord[]): void {
  persist(list);
  favIds.clear();
  for (const f of list) favIds.add(f.id);
  $favorites.set(list);
}

export function isFavorite(id: string): boolean {
  return favIds.has(id);
}

function toRecord(entry: ChatRecordEntry): FavoriteRecord {
  return {
    id: entry.id,
    sessionId: entry.sessionId,
    type: entry.type,
    role: entry.role,
    text: entry.text,
    time: entry.time,
    date: entry.date,
    image: entry.image,
    file: entry.file,
    link: entry.link,
    favoritedAt: Date.now(),
  };
}

/** 收藏 / 取消收藏单条 */
export function toggleFavorite(entry: ChatRecordEntry): void {
  const cur = $favorites.get();
  if (favIds.has(entry.id)) {
    commit(cur.filter((f) => f.id !== entry.id));
  } else {
    commit([toRecord(entry), ...cur]);
  }
}

/** 批量收藏（已收藏的取消、未收藏的添加） */
export function toggleFavoriteBatch(entries: ChatRecordEntry[]): void {
  const cur = $favorites.get();
  const ids = new Set(entries.map((e) => e.id));
  let next = cur.filter((f) => !ids.has(f.id));
  for (const e of entries) {
    if (!favIds.has(e.id)) {
      next = [toRecord(e), ...next];
    }
  }
  commit(next);
}

/** 移除多条收藏 */
export function removeFavorites(ids: string[]): void {
  const set = new Set(ids);
  commit($favorites.get().filter((f) => !set.has(f.id)));
}
