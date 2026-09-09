/**
 * session-store — 官方会话持久化库的 sidecar 侧承载
 *
 * 引擎的会话日志读取/列举全部走官方 `@deepseek-ai/dsh-session-persistence-jsonl`
 * （JsonlSessionPersistence，0.1.5 的官方存储后端本体）。官方类是 cordis Service，
 * 这里用一个独立的最小 cordis Context 承载它（引擎内它由 app-boot loader 装配，
 * sidecar 进程不在引擎树里，官方库无"脱离 cordis 的裸 API"，独立 Context 即官方
 * cordis 内核的标准承载方式）。
 *
 * 官方管道覆盖了此前手搓的全部底层：
 *   - 多帧 zstd 切帧/解压（官方 readZstdPrefix，按帧解）
 *   - 打包 chunk 行展开（官方 session-format-catalog restore，v0→v3 迁移兼容）
 *   - 会话列举（官方 list()，跨 cwd 目录、含旧命名 session.jsonl.zstd 兼容）
 * 上层只保留 mirach 的消息折叠规则（parseSessionLog）与投影底座（raw events）。
 */

import { Context } from "@deepseek-ai/cordis";
import JsonlSessionPersistence from "@deepseek-ai/dsh-session-persistence-jsonl";
import { join } from "node:path";
import { logDebug } from "./protocol.js";

/** 承载官方持久化服务的最小 cordis 上下文（进程级单例）。 */
let ctx: Context | null = null;
let svcPromise: Promise<JsonlPersistenceInstance | null> | null = null;

/** 官方服务切片（只用到 list/locate/readStoredLog/requireStoredLog）。 */
interface StoredArtifact {
  events: { type: string; seq: number; time: number; data: unknown; [key: string]: unknown }[];
  meta: { id: string; cwd?: string; createdAt?: number };
}
interface JsonlPersistenceInstance {
  list(options?: { signal?: AbortSignal }): Promise<{ header: { id: string; cwd?: string; createdAt?: number }; revision: unknown; sizeBytes?: number }[]>;
  locate(meta: { id: string; cwd?: string }): { kind: string; path: string };
  readStoredLog(path: string, expectedId: string, signal?: AbortSignal): Promise<StoredArtifact>;
  requireStoredLog(id: string, signal?: AbortSignal): Promise<StoredArtifact>;
}

/** 惰性创建官方服务（cordis plugin fiber 完成后服务以实例 name 键暴露）。 */
function svc(): Promise<JsonlPersistenceInstance | null> {
  if (!svcPromise) {
    svcPromise = (async () => {
      try {
        ctx = new Context();
        // root/compression 与引擎 profile patch（session-persistence-jsonl 行）一致：
        // 引擎落盘 = DSH_HOME/sessions + zstd。sidecar 读同一位置。
        const root = process.env.DSH_SESSION_ROOT
          ?? join(process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.cwd(), ".mirach"), "sessions");
        await ctx
          .plugin(JsonlSessionPersistence as unknown as Parameters<Context["plugin"]>[0], {
            root,
            compression: "zstd",
          })
          .await();
        const inst = (ctx as unknown as Record<string, unknown>)["sessionPersistence"] as JsonlPersistenceInstance | undefined;
        if (!inst) {
          logDebug("official jsonl persistence service not mounted");
          return null;
        }
        return inst;
      } catch (err) {
        logDebug("official persistence host failed: %s", err instanceof Error ? err.message : String(err));
        return null;
      }
    })();
  }
  return svcPromise;
}

/** 会话快照（官方 list() 的直通面）。 */
export interface SessionArtifactSnapshot {
  id: string;
  cwd?: string;
  createdAt?: number;
  sizeBytes?: number;
}

/** 官方 list()：全部会话（跨项目目录，旧命名兼容）。失败返回 null（调用方回退）。 */
export async function listSessionArtifacts(): Promise<SessionArtifactSnapshot[] | null> {
  const inst = await svc();
  if (!inst) return null;
  try {
    const snapshots = await inst.list();
    return snapshots.map((s) => ({
      id: s.header.id,
      cwd: s.header.cwd,
      createdAt: s.header.createdAt,
      sizeBytes: s.sizeBytes,
    }));
  } catch (err) {
    logDebug("official list failed: %s", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** 官方 requireStoredLog(id)：单会话完整读取（v0→v3 迁移兼容）。找不到/失败返回 null。 */
export async function readSessionArtifact(dshId: string): Promise<StoredArtifact | null> {
  const inst = await svc();
  if (!inst) return null;
  try {
    return await inst.requireStoredLog(dshId);
  } catch (err) {
    logDebug("official read %s failed: %s", dshId, err instanceof Error ? err.message : String(err));
    return null;
  }
}
