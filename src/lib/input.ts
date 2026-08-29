/**
 * input — 输入模拟工具
 *
 * simulateRightClick：在指定坐标派发 contextmenu 事件（button=2）。
 * 用于浏览器/vite 环境测试应用的自定义右键菜单（文件树右键 / 会话操作菜单等），
 * 因为它们绑定在 onContextMenu 上，派发该事件即可触发。
 *
 * 用法（浏览器控制台）：
 *   import { simulateRightClick } from "@/lib/input";  // 或直接在全局调试时调用
 *   simulateRightClick(400, 300);   // 在 (400,300) 处模拟右键
 */

export function simulateRightClick(
  x: number,
  y: number,
  target?: HTMLElement | null,
): void {
  const el = target ?? (document.elementFromPoint(x, y) as HTMLElement | null);
  if (!el) return;
  el.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      button: 2,
      buttons: 2,
    }),
  );
}
