/**
 * tauri-listen — Tauri listen() 的安全清理
 *
 * `listen()` 返回 Promise；若组件在 promise resolve 之前卸载，常规写法
 * （`unsubs.push` 到已被清理的数组）会永久泄漏监听器。collector 记录
 * dispose 状态：dispose 之后再 track 的 unlisten 立即执行。
 */
import type { UnlistenFn } from "@tauri-apps/api/event";

export interface UnlistenCollector {
  /** 传入 listen() 的 unlisten（组件已卸载时立即注销）。 */
  track: (unlisten: UnlistenFn) => void;
  /** 组件卸载时调用（幂等）。 */
  dispose: () => void;
}

export function createUnlistenCollector(): UnlistenCollector {
  let disposed = false;
  const unsubs: UnlistenFn[] = [];
  return {
    track: (unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      unsubs.push(unlisten);
    },
    dispose: () => {
      disposed = true;
      for (const unlisten of unsubs.splice(0)) unlisten();
    },
  };
}
