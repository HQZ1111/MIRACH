/** dsh-kernel 内部日志（浏览器安全；无 node 依赖）。 */

export function logInfo(format: string, ...args: unknown[]): void {
  console.info("[dsh-kernel] " + format, ...args);
}

export function logWarn(...args: unknown[]): void {
  console.warn("[dsh-kernel]", ...args);
}

export function logError(...args: unknown[]): void {
  console.error("[dsh-kernel]", ...args);
}
