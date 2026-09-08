/**
 * with-timeout — 有界等待（hermes src/lib/with-timeout.ts 原样移植）
 *
 * 共享预算：任何要熬过后端冷启动的 renderer await 都用它兜底
 * （BACKEND_BOOT_WAIT_TIMEOUT_MS 与 Rust 侧 prewarm 90s 预算对齐）。
 * 重连类 await 用较短的 RECONNECT_ATTEMPT_TIMEOUT_MS。
 */

/** 主后端冷启动预算（首次连接/预热等待）。健康的冷启动远快于此；超时即失败。 */
export const BACKEND_BOOT_WAIT_TIMEOUT_MS = 45_000;

/** 重连类 attempt 的单次预算（后端已在跑，只是重拨）。 */
export const RECONNECT_ATTEMPT_TIMEOUT_MS = 20_000;

/** Rejection raised by withTimeout. The bounded work is NOT cancelled —
 * the caller decides what a straggler that settles later means. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/** Settle with `promise`, or reject with a TimeoutError after `ms`.
 * `onTimeout` runs synchronously before the rejection is published so callers
 * can revoke ownership of work that would otherwise keep running unowned. If
 * that callback throws, its error becomes this promise's rejection. */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
  onTimeout?: (error: TimeoutError) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new TimeoutError(message);

      try {
        onTimeout?.(error);
      } catch (onTimeoutError) {
        reject(onTimeoutError);

        return;
      }

      reject(error);
    }, ms);

    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
