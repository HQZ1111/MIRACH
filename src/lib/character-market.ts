/**
 * character-market — 在线角色市场（远程角色包拉取）
 *
 * 角色包 = 远程 JSON（UTF-8），结构与内置角色库一致：
 *   { "name": "包名", "version": 1, "updatedAt": "2026-09-01",
 *     "characters": [ { key, name, desc, avatarBg, category, persona }, ... ] }
 *
 * 源管理：内置默认源（mirach 仓库 docs 下的角色包，随仓库发版更新）+
 * 用户自定义源（localStorage 持久化，可增删）。
 * 拉取：Rust fetch_text（绕 WebView CORS，10s 超时 + 5MB 上限）；
 * 结果缓存到 localStorage（离线可用，带拉取时间），「刷新」重新拉。
 */

import { invoke } from "@tauri-apps/api/core";
import type { BuiltinCharacter } from "./tavern-characters";

export interface MarketSource {
  name: string;
  url: string;
}

export interface MarketPack {
  name: string;
  version?: number;
  updatedAt?: string;
  characters: BuiltinCharacter[];
}

export interface MarketCacheEntry {
  fetchedAt: number;
  pack: MarketPack;
}

/** 默认源：mirach 仓库自带的远程角色包（改 docs 里的文件 + 发版即更新市场） */
export const DEFAULT_MARKET_SOURCES: MarketSource[] = [
  {
    name: "Mirach 官方源（Gitee）",
    url: "https://gitee.com/HANQINGZHOU/mirach/raw/master/docs/tavern-characters.remote.json",
  },
];

const SOURCES_KEY = "mirach.tavern-market.sources";
const CACHE_KEY = "mirach.tavern-market.cache";
const MAX_SOURCES = 10;

/** 用户自定义源（不含默认源） */
export function loadCustomSources(): MarketSource[] {
  try {
    const raw = localStorage.getItem(SOURCES_KEY);
    const arr = raw ? (JSON.parse(raw) as MarketSource[]) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && s.url) : [];
  } catch {
    return [];
  }
}

export function saveCustomSources(list: MarketSource[]): void {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(list.slice(0, MAX_SOURCES)));
  } catch {
    /* 配额满静默 */
  }
}

/** 全部源 = 内置默认源 + 自定义源 */
export function allSources(): MarketSource[] {
  return [...DEFAULT_MARKET_SOURCES, ...loadCustomSources()];
}

type MarketCache = Record<string, MarketCacheEntry>;

export function loadCache(): MarketCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const obj = raw ? (JSON.parse(raw) as MarketCache) : {};
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

function saveCache(cache: MarketCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* 配额满静默 */
  }
}

/** 解析并校验角色包 JSON；无有效角色时抛错 */
export function parsePack(text: string): MarketPack {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const list = Array.isArray(raw.characters) ? (raw.characters as Record<string, unknown>[]) : [];
  const characters: BuiltinCharacter[] = list
    .filter((c) => c && typeof c.key === "string" && typeof c.name === "string")
    .map((c) => ({
      key: String(c.key),
      name: String(c.name),
      desc: String(c.desc ?? ""),
      avatarBg: String(c.avatarBg ?? "#8B5CF6"),
      category: String(c.category ?? "在线"),
      persona: String(c.persona ?? ""),
    }));
  if (characters.length === 0) throw new Error("包里没有有效角色（需 characters 数组且每项含 key/name）");
  return {
    name: String(raw.name ?? "远程角色包"),
    version: typeof raw.version === "number" ? raw.version : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
    characters,
  };
}

/** 拉取并缓存一个源的角色包 */
export async function fetchPack(url: string): Promise<MarketPack> {
  const text = await invoke<string>("fetch_text", { url });
  const pack = parsePack(text);
  const cache = loadCache();
  cache[url] = { fetchedAt: Date.now(), pack };
  saveCache(cache);
  return pack;
}

/** 读缓存（拉取失败/离线时展示用） */
export function cachedPack(url: string): MarketCacheEntry | undefined {
  return loadCache()[url];
}

/** 添加自定义源（url 重复忽略）；返回更新后的全部源 */
export function addCustomSource(source: MarketSource): { ok: boolean; sources: MarketSource[]; error?: string } {
  const url = source.url.trim();
  if (!/^https?:\/\//.test(url)) return { ok: false, sources: allSources(), error: "地址需以 http(s) 开头" };
  const custom = loadCustomSources();
  if ([...DEFAULT_MARKET_SOURCES, ...custom].some((s) => s.url === url)) {
    return { ok: false, sources: allSources(), error: "该地址已存在" };
  }
  const next = [...custom, { name: source.name.trim() || "自定义源", url }];
  saveCustomSources(next);
  return { ok: true, sources: allSources() };
}

/** 删除自定义源（默认源不可删） */
export function removeCustomSource(url: string): MarketSource[] {
  saveCustomSources(loadCustomSources().filter((s) => s.url !== url));
  return allSources();
}
