/**
 * notify — 桌面通知（Web Notification API，WebView2 支持）
 */

export async function ensureNotifyPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

/** 显示一条桌面通知（权限未授予时静默跳过） */
export function notify(title: string, body?: string): void {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const n = new Notification(title, { body: body ?? "" });
    window.setTimeout(() => n.close(), 8000);
  } catch {
    /* ignore */
  }
}
