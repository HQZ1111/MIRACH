/**
 * use-window-maximized — 主窗口是否处于系统最大化态
 * （tao 在 WM_SIZE(SIZE_MAXIMIZED) 时更新内部标志，isMaximized 可靠反映）
 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { MOCK } from "@/lib/mock";

export function useWindowMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (MOCK) return;
    // 非 Tauri 宿主（浏览器预览/无 IPC）没有窗口系统：
    // getCurrentWindow() 读 undefined.metadata 会抛错——这是宿主能力边界，
    // 按官方 fail-loud 哲学：环境不支持就不启用该功能（能力探测，非降级兜底）。
    if (!("__TAURI_INTERNALS__" in window)) return;
    const win = getCurrentWindow();
    if (win.label !== "main") return;
    let alive = true;
    const check = async (): Promise<void> => {
      try {
        if (alive) setMaximized(await win.isMaximized());
      } catch {
        /* ignore */
      }
    };
    void check();
    const u1 = win.onResized(() => void check());
    return () => {
      alive = false;
      void u1.then((u) => u());
    };
  }, []);
  return maximized;
}
