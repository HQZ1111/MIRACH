/**
 * kernel-search — 引擎全文检索（session-query-sqlite FTS5）
 *
 * 通过内核 remote.session.search 调用引擎侧全文检索：
 * 数据源 = 引擎原始会话事件流（与 session-persistence 同源），
 * 索引 = SQLite FTS5（profile patch 配置 openAt: first-search 延迟创建）。
 *
 * 返回 SessionHit[] 形状（与 Rust FTS5 searchSessions 兼容），
 * dsh 会话 id 经 dshToMirach 反查映射回前端会话 id。
 */

import type { SessionHit } from "@/lib/api/types";

/** 内核 ctx 的最小使用面（避免 import boot.ts 导致循环/双实例） */
interface KernelCtx {
  get(key: string): unknown;
}

interface RemoteNs {
  namespaces?: Map<string, { service?: Record<string, unknown> } & Record<string, unknown>>;
}

export async function kernelSearchSessions(
  query: string,
  dshToMirach?: Map<string, string>,
): Promise<SessionHit[]> {
  const c = (window as unknown as { __mirachCtx?: KernelCtx }).__mirachCtx;
  if (!c) return [];
  try {
    const remote = c.get("remote") as RemoteNs | undefined;
    const ns = remote?.namespaces;
    const sess = ns instanceof Map ? ns.get("session") : undefined;
    const svc = (sess?.service ?? sess) as Record<string, unknown> | undefined;
    if (typeof svc?.search !== "function") return [];
    const r = (await (svc.search as (req: unknown) => Promise<Record<string, unknown>>)(
      { query, limit: 20 },
    )) as { ok?: boolean; value?: { items?: Record<string, unknown>[] } } | undefined;
    if (!r?.ok || !Array.isArray(r.value?.items)) return [];
    return r.value.items
      .map((item) => {
        const dshId = String(item.sessionId ?? item.session_id ?? "");
        return {
          sessionId: dshToMirach?.get(dshId) ?? dshId,
          title: String(item.title ?? ""),
          snippet: String(item.snippet ?? item.highlight ?? ""),
          role: String(item.role ?? "user"),
          messageId: Number(item.messageId ?? item.seq ?? 0),
        };
      })
      .filter((h) => h.sessionId);
  } catch {
    return [];
  }
}
