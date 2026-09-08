/**
 * session-env — 会话归属索引（引擎侧环境映射的客户端缓存）
 *
 * 权威数据源是引擎：环境切换时 MainPanel 串行下发 dsh_set_env（会话映射
 * 命名空间 "<envId>::<会话id>" + 工作区 cwd），会话在引擎侧按环境持久化，
 * dsh_list_sessions 对每个引擎会话返回归属 envId。本模块把这份归属缓存成
 * sessionId → envId 的订阅型索引，供侧栏把官方全局会话列表落到"当前环境
 * 的会话"——环境本身生效（引擎命名空间 + 按环境持久化），会话自然隔离，
 * 这里没有任何客户端自造的分组规则。
 *
 * 归属判定（侧栏过滤用）：
 *  - 索引里有 → 属于该环境；
 *  - 索引里没有（引擎还没给它归属——从未在任何环境激活过的遗留会话）
 *    → 视为 main 遗留会话，只在主环境显示，其他环境不被历史数据污染；
 *  - 官方当前会话（list.current）恒显示——新建任务即刻可见，不必等第一条
 *    消息触发引擎映射。
 */

import { atom } from "nanostores";

export const $sessionEnvIndex = atom<Record<string, string>>({});

/** dsh_list_sessions 的一行里与归属有关的字段 */
export interface EngineSessionRow {
  id?: string;
  frontendId?: string;
  envId?: string;
}

/** 引擎会话行并入索引（frontendId = 内核会话 id；无 envId 的行忽略） */
export function importEngineSessionEnv(rows: EngineSessionRow[]): void {
  const next = { ...$sessionEnvIndex.get() };
  let changed = false;
  for (const r of rows) {
    const id = r.frontendId || r.id;
    if (!id || !r.envId || next[id] === r.envId) continue;
    next[id] = r.envId;
    changed = true;
  }
  if (changed) $sessionEnvIndex.set(next);
}

/** 会话归属环境 id；null = 引擎尚无归属（从未激活过的遗留会话） */
export function envOfSession(id: string): string | null {
  return $sessionEnvIndex.get()[id] ?? null;
}

/** 侧栏过滤谓词：会话是否属于指定环境（含"当前会话恒显示"例外） */
export function sessionBelongsToEnv(
  id: string,
  envId: string,
  currentSessionId: string | undefined,
): boolean {
  if (currentSessionId !== undefined && id === currentSessionId) return true;
  const own = envOfSession(id);
  return own === envId || (own === null && envId === "main");
}
