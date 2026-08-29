/**
 * Hermes agent-sidecar — 协议与日志工具
 *
 * 与 Tauri Rust 后端之间走 stdin/stdout JSON 行协议（同 zosma sidecar）：
 *   标准输入（命令）:  {"type":"<cmd>", ...}
 *   标准输出（事件）:  {"type":"event", "event":<pi 事件>}
 *                     {"type":"result","id","data"}
 *                     {"type":"done","id"}
 *                     {"type":"error","id","message"}
 *                    {"type":"ready","models","providers","activeModel"}
 *
 * 所有日志一律走 stderr（stdout 是协议通道）。
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

function activeLevel(): number {
  const raw = process.env.SIDECAR_LOG_LEVEL;
  return (raw !== undefined && raw in LEVELS ? LEVELS[raw as LogLevel] : LEVELS.info) as number;
}

/** printf 风格格式化（%s/%d/%j）；首个参数含占位符时消费后续实参，
 *  否则原样拼接（兼容直接多参连打的调用习惯）。 */
function format(args: unknown[]): string {
  const [first, ...rest] = args;
  if (typeof first === "string" && /%[sdj]/.test(first) && rest.length > 0) {
    let i = 0;
    const body = first.replace(/%[sdj]/g, (tag) => {
      const v = rest[i++];
      if (tag === "%d") return String(Number(v));
      if (tag === "%j") return JSON.stringify(v);
      return String(v);
    });
    return rest.length > i ? `${body} ${rest.slice(i).join(" ")}` : body;
  }
  return args.map(String).join(" ");
}

export function logAt(level: LogLevel, ...args: unknown[]): void {
  if (LEVELS[level] > activeLevel()) return;
  process.stderr.write(`[sidecar:${level}] ${format(args)}\n`);
}

export const log = (...args: unknown[]): void => logAt("info", ...args);
export const logWarn = (...args: unknown[]): void => logAt("warn", ...args);
export const logError = (...args: unknown[]): void => logAt("error", ...args);
export const logDebug = (...args: unknown[]): void => logAt("debug", ...args);

/** 向 stdout 写一条 JSON 行；EPIPE（后端已退出）时干净地结束进程。 */
export function send(obj: unknown): void {
  try {
    process.stdout.write(`${JSON.stringify(obj)}\n`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "EPIPE") {
      process.exit(0);
    }
    throw err;
  }
}

process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") {
    process.exit(0);
  }
});
