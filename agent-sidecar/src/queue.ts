/**
 * Hermes agent-sidecar — 消息队列管理（steer / follow-up）
 *
 * 官方队列语义在引擎侧：stdio SDK 的 `prompt()` 即"入引擎 durable inbox"
 * （官方注释：Queue one prompt and return its durable inbox identity），
 * web 面另有 `session/prompt` 的 delivery mode（steer/queue）与
 * `session/updateQueue`（改排队项）——mirach 内核（官方 client 栈）直连
 * 该面，是官方路径。
 *
 * 本类只服务 Tauri/pi 侧车通道的传输语义：把进同一 FIFO 的消息逐条交给
 * `session.run()`（run 本身 = 官方"入队 + 观察到 idle"），并向 Tauri 后端
 * 发 `queue_update`（前端 QUEUE_UPDATE / QUEUE_OPTIMISTIC 用它管理排队指示）。
 * 真正的排队/去重/持久化在引擎 inbox，这里不重复实现。
 */

import { logDebug } from "./protocol.js";

export type QueueKind = "steer" | "follow_up" | "prompt";

export interface QueuedMessage {
  kind: QueueKind;
  text: string;
  /** 入队时生成，用于 run 结果/错误与 done 的 id 关联。 */
  cmdId: string;
  /** 消息携带的模型（provider/model，缺省沿用 sidecar activeModel）。 */
  provider?: string;
  model?: string;
}

export interface QueueManagerHooks {
  onUpdate: (steering: readonly string[], followUp: readonly string[]) => void;
}

export class MessageQueue {
  private items: QueuedMessage[] = [];
  private hooks: QueueManagerHooks;

  constructor(hooks: QueueManagerHooks) {
    this.hooks = hooks;
  }

  get length(): number {
    return this.items.length;
  }

  enqueue(msg: QueuedMessage): void {
    this.items.push(msg);
    this.emit();
    logDebug("queue: enqueue %s (%s) — %d pending", msg.kind, msg.cmdId, this.items.length);
  }

  /** 取队列头（不删除——发送失败时留在队列里）。 */
  peek(): QueuedMessage | undefined {
    return this.items[0];
  }

  /** 发送成功/失败后弹出队列头。 */
  dequeue(cmdId: string): QueuedMessage | undefined {
    const i = this.items.findIndex((m) => m.cmdId === cmdId);
    if (i >= 0) {
      const [removed] = this.items.splice(i, 1);
      this.emit();
      logDebug("queue: dequeue %s (%s) — %d pending", removed.kind, cmdId, this.items.length);
      return removed;
    }
    return undefined;
  }

  /** 清空队列但保留在飞条目（abort/clear_queue 不能把正在执行的 turn 当排队项
   *  收尾——否则会与 runOne 的 done 重复终结同一 cmdId，前端收到假"已中止"）。
   *  steer/follow_up 的文本返回给前端；prompt 类条目没有去处，经 `dropped`
   *  交回调用方补收尾信封（否则对应气泡永久转圈）。 */
  drainExcept(keep: string | null): { steering: string[]; followUp: string[]; dropped: QueuedMessage[] } {
    const kept = keep === null ? [] : this.items.filter((m) => m.cmdId === keep);
    const rest = keep === null ? this.items : this.items.filter((m) => m.cmdId !== keep);
    const steering: string[] = [];
    const followUp: string[] = [];
    const dropped: QueuedMessage[] = [];
    for (const m of rest) {
      if (m.kind === "steer") steering.push(m.text);
      else if (m.kind === "follow_up") followUp.push(m.text);
      else dropped.push(m);
    }
    this.items = kept;
    this.emit();
    return { steering, followUp, dropped };
  }

  snapshot(): { steering: string[]; followUp: string[] } {
    const steering: string[] = [];
    const followUp: string[] = [];
    for (const m of this.items) {
      if (m.kind === "steer") steering.push(m.text);
      else if (m.kind === "follow_up") followUp.push(m.text);
    }
    return { steering, followUp };
  }

  private emit(): void {
    const { steering, followUp } = this.snapshot();
    this.hooks.onUpdate(steering, followUp);
  }
}
