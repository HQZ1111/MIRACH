/**
 * logger — 轻量应用日志缓冲
 *
 * 捕获 console 输出与未捕获错误到环形缓冲区（最近 200 条），
 * 供顶栏"导出日志"弹窗查看与导出 .txt。
 */

export interface LogEntry {
  time: string;
  level: "log" | "warn" | "error";
  message: string;
}

const MAX = 200;
const buffer: LogEntry[] = [];

let hooked = false;

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmtTime(): string {
  const d = new Date();
  return (
    `${d.toLocaleDateString()} ${d.toLocaleTimeString()} ` +
    String(d.getMilliseconds()).padStart(3, "0")
  );
}

/** 初始化日志捕获（应用启动时调用一次） */
export function initLogger(): void {
  if (hooked) return;
  hooked = true;

  const push = (level: LogEntry["level"], args: unknown[]) => {
    buffer.push({
      time: fmtTime(),
      level,
      message: args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "),
    });
    if (buffer.length > MAX) buffer.splice(0, buffer.length - MAX);
  };

  const origLog = console.log;
  const origWarn = console.warn;
  const origError = console.error;
  console.log = (...args: unknown[]) => {
    push("log", args);
    origLog(...args);
  };
  console.warn = (...args: unknown[]) => {
    push("warn", args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    push("error", args);
    origError(...args);
  };
  window.addEventListener("error", (e) => push("error", [e.message]));
  window.addEventListener("unhandledrejection", (e) => push("error", [String(e.reason)]));
}

export function getLogs(): LogEntry[] {
  return [...buffer];
}

export function clearLogs(): void {
  buffer.length = 0;
}

/** 导出日志为 .txt 下载 */
export function exportLogs(): void {
  const text =
    buffer
      .map((l) => `[${l.time}] [${l.level.toUpperCase()}] ${l.message}`)
      .join("\n") || "（无日志）";
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `hermes-log-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}
