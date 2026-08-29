/**
 * useBackgroundAutoDismiss - 后台进程自动消失
 *
 * 成功 4s / 失败 12s 后自动移除。
 */

import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import {
  $bgState,
  removeBackgroundProcess,
  getLingerMs,
} from "@/store/background-processes";

export function useBackgroundAutoDismiss() {
  const { processes } = useStore($bgState);

  useEffect(() => {
    const timers: number[] = [];

    for (const p of processes) {
      if (p.status === "running" || !p.completedAt) continue;
      const elapsed = Date.now() - p.completedAt;
      const linger = getLingerMs(p.status);
      const delay = Math.max(0, linger - elapsed);
      const timer = window.setTimeout(
        () => removeBackgroundProcess(p.id),
        delay,
      );
      timers.push(timer);
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [processes]);
}
