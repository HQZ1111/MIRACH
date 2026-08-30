/**
 * dsh-kernel/protocol-shim — sidecar adapter 的 node 日志依赖的浏览器替身。
 * vite 把 agent-sidecar/src/protocol.js 重定向到这里（见 vite.config.ts alias），
 * 让 adapter（392 行 dsh→pi 事件映射）零改动跑在浏览器里。
 */

export function log(_format: string, ..._args: unknown[]): void {
  /* 静默：内核镜像的日志走前端 logger */
}
export function logDebug(_format: string, ..._args: unknown[]): void {
  /* 静默 */
}
export function logWarn(...args: unknown[]): void {
  console.warn("[dsh-kernel]", ...args);
}
export function logError(...args: unknown[]): void {
  console.error("[dsh-kernel]", ...args);
}
export function send(_msg: unknown): void {
  /* sidecar stdout 信封在浏览器态不存在 */
}
