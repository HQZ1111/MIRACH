/**
 * Hermes agent-sidecar — 消息队列管理（steer / follow-up）
 *
 * dsh 运行时没有原生 steer/follow-up 命令（协议只有 initialize /
 * session/prompt / shutdown），队列由 sidecar 自管理：
 *  - `send_prompt` / steer / follow-up 都进同一个 FIFO 队列（prompt 是
 *    用户发的新消息，steer/follow-up 是插入消息）；
 *  - 队列有内容时 worker 逐一 `session.run()`（dsh 的 inbox 天然按序处理，
 *    每次 run 都会跑到 agent idle 才 resolve）；
 *  - 每次入队/出队都向 Tauri 后端发 `queue_update`（前端 QUEUE_UPDATE /
 *    QUEUE_OPTIMISTIC 用它管理排队指示）。
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

  /** 清空队列（前端 Ctrl+↑ 拉回排队消息编辑时）。
   *  steer/follow_up 的文本返回给前端；prompt 类条目没有去处，经 `dropped`
   *  交回调用方补收尾信封（否则对应气泡永久转圈）。 */
  drain(): { steering: string[]; followUp: string[]; dropped: QueuedMessage[] } {
    const steering: string[] = [];
    const followUp: string[] = [];
    const dropped: QueuedMessage[] = [];
    for (const m of this.items) {
      if (m.kind === "steer") steering.push(m.text);
      else if (m.kind === "follow_up") followUp.push(m.text);
      else dropped.push(m);
    }
    this.items = [];
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
