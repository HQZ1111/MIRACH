/**
 * sessions - 会话列表 store（本地持久化）
 *
 * 会话管理的本地实现：新建 / 重命名 / 置顶 / 归档（软删除）/ 删除 / 导出 JSON。
 * 数据存 localStorage（hermes.sessions.v1）。
 *
 * 接真实 Mirach 后端后，这些操作由 tui_gateway 的 session.* RPC 替换
 * （见 docs/api-contract.md）；届时保留 store 接口、换掉实现即可。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";
import { bumpEnvEpoch } from "@/store/environments";

export interface SessionItem {
  id: string;
  title: string;
  preview: string;
  time: string;
  pinned: boolean;
  archived: boolean;
  /** 创建时间（毫秒时间戳；Starmap 时间轴排序用，旧数据缺省时回填） */
  createdAt: number;
}

/**
 * 会话存储按【工作环境】分片（真隔离，非显示过滤）：
 *   hermes.sessions.v1.<envId> —— 每个环境一张独立会话表；
 *   旧的无后缀键（hermes.sessions.v1）数据一次性并入 main 分片。
 * currentEnv 由 MainPanel 在切左栏模式/改环境信息时经 setSessionsEnv 下发。
 */
const LEGACY_STORAGE_KEY = "mirach.sessions.v1";

function storageKey(envId: string): string {
  return `mirach.sessions.v1.${envId || "main"}`;
}

/** 当前活跃环境 id（MainPanel 随 activeView/envVersion 同步下发）。 */
let activeEnvId = "main";

// 初始种子（mock 模式；真实模式下从后端拉取）
// 种子数据时间基准：相对当前时刻倒推（仅首次写入 localStorage 时生效）
const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const SEED: SessionItem[] = MOCK
  ? [
      { id: "s1", title: "前端架构重构方案", preview: "讨论了组件拆分、状态管理优化", time: "12:34", pinned: true, archived: false, createdAt: NOW - 2 * HOUR },
      { id: "s2", title: "API 接口设计评审", preview: "确认了 RESTful 规范和错误码", time: "11:20", pinned: true, archived: false, createdAt: NOW - 5 * HOUR },
      { id: "s3", title: "数据库迁移计划", preview: "MySQL → PostgreSQL 方案评估", time: "昨天", pinned: false, archived: false, createdAt: NOW - DAY - 2 * HOUR },
      { id: "s4", title: "性能优化讨论", preview: "分析了慢查询和缓存策略", time: "昨天", pinned: false, archived: false, createdAt: NOW - DAY - 8 * HOUR },
      { id: "s5", title: "CI/CD 流水线配置", preview: "Docker 多阶段构建优化完成", time: "周三", pinned: false, archived: false, createdAt: NOW - 3 * DAY },
      { id: "s6", title: "代码审查: 认证模块", preview: "JWT token 刷新逻辑重构", time: "周三", pinned: false, archived: false, createdAt: NOW - 3 * DAY - 6 * HOUR },
      { id: "s7", title: "新功能需求分析", preview: "消息推送和实时通知方案", time: "周一", pinned: false, archived: false, createdAt: NOW - 6 * DAY - 2 * HOUR },
    ]
  : [];

function load(envId: string): SessionItem[] {
  const key = storageKey(envId);
  // 旧数据迁移：main 分片首载时，把无后缀旧键的条目并入（一次性，老键保留不动）
  if (!localStorage.getItem(key) && envId === "main") {
    try {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        localStorage.setItem(key, legacy);
      }
    } catch {
      /* 迁移失败忽略 */
    }
  }
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw) as SessionItem[];
      if (Array.isArray(arr)) {
        // 旧版本数据没有 createdAt：按列表顺序倒推回填（越靠前越新）；
        // preview/title 缺失兜底，避免列表渲染/空白判定抛错
        const now = Date.now();
        return arr
          .map((s, i) => ({
            ...s,
            title: typeof s.title === "string" && s.title ? s.title : "新会话",
            preview: typeof s.preview === "string" ? s.preview : "",
            createdAt: typeof s.createdAt === "number" ? s.createdAt : now - (i + 1) * 3 * HOUR,
          }))
          // 演示种子清洗（真实模式）：s1~s7 是早期 mock 硬编码会话，落过盘的
          // 会永远顶在列表里——用户看到的"全是硬编码"就是它们
          .filter((s) => MOCK || !/^s[1-7]$/.test(s.id));
      }
    }
  } catch {
    /* 解析失败回退种子 */
  }
  return MOCK ? SEED : [];
}

function persist(list: SessionItem[]): void {
  try {
    localStorage.setItem(storageKey(activeEnvId), JSON.stringify(list));
  } catch {
    /* 存储失败忽略（隐私模式等） */
  }
}

export const $sessions = atom<SessionItem[]>(load("main"));

/** 切换活跃环境：重新加载该环境的会话表到 $sessions（真隔离核心）。
 *  由 MainPanel 在左栏模式/环境版本变化时调用；同时 bump 环境代数，
 *  让旧环境的流式回调自行丢弃后续事件。 */
export function setSessionsEnv(envId: string): void {
  const env = envId || "main";
  if (env === activeEnvId) return;
  activeEnvId = env;
  $sessions.set(load(env));
  bumpEnvEpoch();
}

/** 当前会话表所属环境 id */
export function sessionsEnv(): string {
  return activeEnvId;
}

/** 已确认"有内容"的会话 id 集合（对齐 dsh：空白会话从列表隐藏、新建任务复用）。
 *  由 MainPanel 历史回放（非空）与 appendUserMessage（发送消息）标记；
 *  preview 为空 + 不在本集合 → 视为空白会话。 */
const contentSessions = new Set<string>();

export function markSessionContent(id: string): void {
  if (id) contentSessions.add(id);
}

/** 会话是否已有内容（本会话标记过，或旧数据 preview 非空） */
export function hasSessionContent(id: string): boolean {
  if (contentSessions.has(id)) return true;
  const s = $sessions.get().find((x) => x.id === id);
  return Boolean(s && typeof s.preview === "string" && s.preview.trim() !== "");
}

function commit(list: SessionItem[]): void {
  persist(list);
  $sessions.set(list);
}

/**
 * 真实模式：并入引擎会话列表（按 id 去重，引擎侧优先）。整体替换会清掉本地
 * 新建但尚未有历史的条目；合并既保住引擎磁盘上的历史会话，也保住新开回话。
 */
export function importRealSessions(items: SessionItem[]): void {
  if (items.length === 0) return;
  const seen = new Set<string>();
  const merged: SessionItem[] = [];
  for (const s of items) {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      merged.push(s);
    }
  }
  for (const s of $sessions.get()) {
    if (!seen.has(s.id)) merged.push(s);
  }
  commit(merged);
}

/** 引擎历史会话直接入列（dsh_list_sessions 导入用，带标题可当列表项渲染） */
export function upsertEngineSession(item: SessionItem): void {
  const rest = $sessions.get().filter((s) => s.id !== item.id);
  commit([item, ...rest]);
}

let idSeq = 0;

/** 新建会话（默认置顶新会话到列表顶部） */
export function createSession(title = "新会话"): SessionItem {
  const s: SessionItem = {
    id: `s${Date.now()}_${idSeq++}`,
    title: title || "新会话",
    preview: "",
    time: "刚刚",
    pinned: false,
    archived: false,
    createdAt: Date.now(),
  };
  commit([s, ...$sessions.get()]);
  return s;
}

export function renameSession(id: string, title: string): void {
  commit(
    $sessions.get().map((s) => (s.id === id ? { ...s, title: title || s.title } : s)),
  );
}

export function togglePin(id: string): void {
  commit(
    $sessions.get().map((s) => (s.id === id ? { ...s, pinned: !s.pinned } : s)),
  );
}

/** 归档（软删除）：从普通列表隐藏，可恢复 */
export function archiveSession(id: string): void {
  commit(
    $sessions.get().map((s) => (s.id === id ? { ...s, archived: true, pinned: false } : s)),
  );
}

export function restoreSession(id: string): void {
  commit(
    $sessions.get().map((s) => (s.id === id ? { ...s, archived: false } : s)),
  );
}

/** 彻底删除（同时清内容标记，否则残留 id 恒判非空白、无界增长） */
export function deleteSession(id: string): void {
  contentSessions.delete(id);
  commit($sessions.get().filter((s) => s.id !== id));
}

/** 会话内容变化（发出消息/AI 回复定稿）→ 即时刷新列表预览与时间戳 */
export function touchSessionPreview(id: string, text: string): void {
  const t = text.trim();
  if (!t) return;
  commit(
    $sessions.get().map((s) =>
      s.id === id ? { ...s, preview: t.slice(0, 120), time: "刚刚" } : s,
    ),
  );
}

/** 导出会话为 JSON 文件（下载） */
export function exportSession(id: string): void {
  const s = $sessions.get().find((x) => x.id === id);
  if (!s) return;
  const blob = new Blob([JSON.stringify(s, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${s.title || "session"}.json`;
  a.click();
  // 延迟 revoke：部分浏览器（尤其 Firefox）会在下载尚未开始时中止
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
