/**
 * windowState — 窗口几何持久化 + 关闭确认（quit guard）
 *
 * - 记住主窗口位置/尺寸，重启恢复（localStorage）
 * - 有后台进程运行中时，关闭前确认
 */

import { getCurrentWindow, availableMonitors } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { $bgState } from "@/store/background-processes";
import { $quitConfirm } from "@/store/quit-confirm";
import { MOCK } from "@/lib/mock";

const KEY = "mirach.windowState.v1";

/** 主窗口几何持久化（仅 main 窗口；session-new / quick-entry 不参与） */
export async function initWindowState(): Promise<void> {
  try {
    const win = getCurrentWindow();
    if (win.label && win.label !== "main") return;

    // 恢复（outerPosition/outerSize 返回物理像素，恢复也用 Physical* —— 之前误用
    // Logical* 在缩放 ≠100% 或换显示器后位置错位；且位置须与任一显示器相交，
    // 否则回退居中，防止窗口跑到屏幕外（Windows 会停靠在 -32000,-32000 不可见））
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) {
        const { x, y, w, h } = JSON.parse(saved) as { x: number; y: number; w: number; h: number };
        const monitors = await availableMonitors();
        const onScreen = monitors.some((m) => {
          const p = m.position;
          const s = m.size;
          return x < p.x + s.width - 80 && x + 80 > p.x && y < p.y + s.height - 60 && y + 60 > p.y;
        });
        if (onScreen && w >= 600 && h >= 500) {
          // 位置钳制进桌面（x/y=-8 之类的最大化残影位置会让缩放手柄落在屏外）
          const cx = Math.max(0, Math.min(x, Math.max(...monitors.map((m) => m.position.x + m.size.width)) - 200));
          const cy = Math.max(0, Math.min(y, Math.max(...monitors.map((m) => m.position.y + m.size.height)) - 100));
          const posChanged = cx !== x || cy !== y;
          // 尺寸钳制：上限 = 窗口默认 1660×980（软件面板 1580×900 + 各 40px 阴影边距；tauri.conf 勿改），
          // 并限最大显示器内（防历史保存的怪尺寸把窗口撑大）
          const maxW = Math.max(600, Math.min(1660, Math.max(...monitors.map((m) => m.size.width)) - 40));
          const maxH = Math.max(500, Math.min(980, Math.max(...monitors.map((m) => m.size.height)) - 40));
          await win.setPosition(new PhysicalPosition(cx, cy));
          await win.setSize(new PhysicalSize(Math.min(w, maxW), Math.min(h, maxH)));
          if (posChanged) localStorage.setItem(KEY, JSON.stringify({ x: cx, y: cy, w: Math.min(w, maxW), h: Math.min(h, maxH) }));
        } else {
          await win.center();
        }
      }
    } catch {
      /* 恢复失败忽略 */
    }

    // 保存（防抖 500ms）
    let t: number | undefined;
    const save = async () => {
      try {
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        localStorage.setItem(
          KEY,
          JSON.stringify({ x: pos.x, y: pos.y, w: size.width, h: size.height }),
        );
      } catch {
        /* ignore */
      }
    };
    const schedule = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => void save(), 500);
    };
    await win.onMoved(schedule);
    await win.onResized(schedule);
  } catch {
    /* 非 Tauri 环境 */
  }
}

/**
 * 关闭确认：有后台任务运行中时先确认再关（真实模式）。
 *
 * 演示模式（MOCK）跳过：mock 播种的假进程会永远 running，若走守卫会把关闭卡死；
 * 且 window.confirm 在 Tauri WebView 不弹原生框。真实模式下经 $quitConfirm store
 * 弹应用内确认弹窗（QuitConfirmOverlay），确认后 win.destroy() 关闭。
 */
export async function initQuitGuard(): Promise<void> {
  if (MOCK) return;
  try {
    const win = getCurrentWindow();
    // 确认弹窗已打开时再点关闭按钮：不覆盖回调，只保留首个请求
    let pending: ((ok: boolean) => void) | null = null;
    const un = await win.onCloseRequested(async (event) => {
      const { processes } = $bgState.get();
      const running = processes.filter((p) => p.status === "running").length;
      if (running > 0 && !pending) {
        event.preventDefault();
        const ok = await new Promise<boolean>((resolve) => {
          pending = resolve;
          $quitConfirm.set({ running, resolve });
        });
        pending = null;
        $quitConfirm.set(null);
        if (ok) await win.destroy();
      }
    });
    void un;
  } catch {
    /* 非 Tauri 环境 */
  }
}
