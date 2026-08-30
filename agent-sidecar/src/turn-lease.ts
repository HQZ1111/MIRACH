/**
 * turn-lease — 按解析后会话 id 的回合租约
 *
 * 移植自 Hermes Agent gateway/turn_lease.py 的语义（D:\hermes-agent-main，
 * #64934）：路由键(前端会话 id)与转录所有者(dsh session id)是多对一映射，
 * 只按路由键串行不足以保护同一份持久日志——两个键各跑一个 turn 会交错
 * flush。租约按【解析后的 dsh session id】取，代际令牌 + 身份校验释放 +
 * 超时 fail-open。
 *
 * 与 Hermes 的差异（诚实标注）：
 *   - sidecar 现有全局串行队列让进程内竞争在今天就不可达；本租约是
 *     不变式 enforcement + 碰撞重试双 runIn 的防御 + B 桥接层（全局队列
 *     消失、多客户端接入）的先置件。跨进程保护当前由引擎的持久日志身份
 *     守卫（id collision → 换新 id）承担，不变。
 *   - 进程内实现：registry 只持有"在持"条目，天然有界。
 *
 * 安全属性（对应 hermes 原注释）：
 *   1. 代际作用域、身份校验释放：stale 释放永远放不掉新回合的租约；释放幂等。
 *   2. 超时 fail-open：卡死的持有者降级为"未串行"并大声 ERROR——宁可退化
 *      不可楔死；降级令牌不持任何东西、释放是 no-op。
 *   3. registry 有界：超过 MAX Held 时的行为见 acquire（拒绝并 fail-open）。
 */

import { randomUUID } from "node:crypto";
import { logError, logWarn } from "./protocol.js";

/** 一次成功获取的回合租约令牌。 */
export interface TurnLeaseToken {
  readonly sessionId: string;
  readonly owner: string;
  readonly generation: number;
  /** 释放租约（身份不匹配或已释放时 no-op）。 */
  release(): void;
}

export type TurnLeaseResult =
  | { ok: true; token: TurnLeaseToken }
  | { ok: false; holder?: string };

interface HeldLease {
  owner: string;
  generation: number;
}

/** 在持租约上限：正常并发远达不到；达到即 fail-open（防御性上限）。 */
const MAX_HELD = 512;
/** 争用等待上限：超过即 fail-open（对应 hermes 的 bounded wait）。 */
const DEFAULT_WAIT_MS = 30_000;

class TurnLeaseRegistry {
  private readonly held = new Map<string, HeldLease>();
  private generation = 0;
  /** 等待者唤醒队列：sessionId → 等待中的 resolvers */
  private readonly waiters = new Map<string, Array<{ owner: string; resolve: (granted: boolean) => void }>>();

  /**
   * 获取租约；被持有时等待至多 waitMs，超时 fail-open。
   * fail-open 返回 ok:false 且 holder 标注持有者（调用方大声告警后继续跑）。
   */
  async acquire(
    sessionId: string,
    owner: string,
    waitMs = DEFAULT_WAIT_MS,
  ): Promise<TurnLeaseResult> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const current = this.held.get(sessionId);
      if (current === undefined) {
        if (this.held.size >= MAX_HELD) {
          logError("turn lease registry full (%d held) — fail-open for %s", this.held.size, sessionId);
          return { ok: false };
        }
        const generation = ++this.generation;
        this.held.set(sessionId, { owner, generation });
        logWarn("turn lease acquired: %s gen=%d owner=%s", sessionId, generation, owner);
        return {
          ok: true,
          token: {
            sessionId,
            owner,
            generation,
            release: () => this.release(sessionId, owner, generation),
          },
        };
      }
      if (Date.now() >= deadline) {
        // fail-open：宁可退化不可楔死（对应 hermes 超时语义）
        logError(
          "turn lease CONTESTED on %s held by %s — proceeding UNSERIALIZED after %dms wait (fail-open)",
          sessionId,
          current.owner,
          waitMs,
        );
        return { ok: false, holder: current.owner };
      }
      const granted = await this.waitOnce(sessionId, owner, deadline);
      if (!granted && Date.now() >= deadline) {
        const holder = this.held.get(sessionId);
        logError(
          "turn lease CONTESTED on %s held by %s — proceeding UNSERIALIZED (fail-open)",
          sessionId,
          holder?.owner ?? "unknown",
        );
        return { ok: false, holder: holder?.owner };
      }
    }
  }

  /** 等一次唤醒或超时；granted 表示"被唤醒"（拿到者重走 acquire 的空闲检查）。 */
  private waitOnce(sessionId: string, owner: string, deadline: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const entry = {
        owner,
        resolve: (granted: boolean) => {
          if (timer !== undefined) clearTimeout(timer);
          resolve(granted);
        },
      };
      let list = this.waiters.get(sessionId);
      if (list === undefined) {
        list = [];
        this.waiters.set(sessionId, list);
      }
      list.push(entry);
      timer = setTimeout(() => {
        const l = this.waiters.get(sessionId);
        if (l !== undefined) {
          const idx = l.indexOf(entry);
          if (idx >= 0) l.splice(idx, 1);
          if (l.length === 0) this.waiters.delete(sessionId);
        }
        resolve(false);
      }, Math.max(1, deadline - Date.now()));
    });
  }

  /** 身份校验释放：仅当前持有者 + 当前代际生效；幂等。 */
  private release(sessionId: string, owner: string, generation: number): void {
    const current = this.held.get(sessionId);
    if (current === undefined) return; // 幂等：已释放
    if (current.generation !== generation || current.owner !== owner) {
      // 代际不匹配：stale 释放，绝不能放掉新回合的租约
      logWarn(
        "turn lease stale release ignored on %s (gen %d/%s vs held gen %d/%s)",
        sessionId,
        generation,
        owner,
        current.generation,
        current.owner,
      );
      return;
    }
    this.held.delete(sessionId);
    logWarn("turn lease released: %s gen=%d", sessionId, generation);
    // 只唤醒一个等待者（拿到者重走 acquire 的空闲检查）
    const list = this.waiters.get(sessionId);
    if (list !== undefined && list.length > 0) {
      const next = list.shift()!;
      if (list.length === 0) this.waiters.delete(sessionId);
      next.resolve(true);
    }
  }
}

const registry = new TurnLeaseRegistry();

/**
 * 进程级单例入口：按解析后的 dsh session id 获取回合租约。
 * @param sessionId - 解析完成（含碰撞换新 id 之后）的 dsh 会话 id。
 * @param owner - 归因标签（boot id + 命令 id），日志与身份校验用。
 */
export async function withTurnLease<T>(
  sessionId: string,
  owner: string,
  run: () => Promise<T>,
  waitMs?: number,
): Promise<T> {
  const lease = await registry.acquire(sessionId, owner, waitMs);
  if (!lease.ok) {
    // fail-open：调用方照常执行，但这条路径没有串行保护（大声日志已打）
    return run();
  }
  try {
    return await run();
  } finally {
    lease.token.release();
  }
}

/** 归因标签：每次 boot 唯一，日志里能区分两个 sidecar 实例。 */
export const LEASE_BOOT_ID = randomUUID().slice(0, 8);
