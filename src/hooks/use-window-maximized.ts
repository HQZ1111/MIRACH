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
