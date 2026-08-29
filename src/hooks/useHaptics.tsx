/**
 * useHaptics — 触感反馈 Provider/Hook
 *
 * 提供 triggerHaptic / muted / toggleMuted；挂载时预热 AudioContext。
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  isHapticsMuted,
  setHapticsMuted,
  triggerHaptic,
  warmupHaptics,
  type HapticIntent,
} from "@/lib/haptics";

interface HapticsContextValue {
  /** 触发一次触感反馈（静音时静默） */
  trigger: (intent: HapticIntent, source?: string) => void;
  /** 当前是否静音 */
  muted: boolean;
  /** 切换静音（调用方自行处理播放 tap/success 确认音） */
  toggle: () => boolean;
}

const HapticsContext = createContext<HapticsContextValue | null>(null);

export function HapticsProvider({ children }: { children: ReactNode }) {
  const [muted, setMuted] = useState<boolean>(isHapticsMuted);

  useEffect(() => {
    warmupHaptics();
  }, []);

  const trigger = useCallback((intent: HapticIntent, source?: string) => {
    triggerHaptic(intent, source);
  }, []);

  const toggle = useCallback(() => {
    const next = !isHapticsMuted();
    setHapticsMuted(next);
    setMuted(next);
    return next;
  }, []);

  return (
    <HapticsContext.Provider value={{ trigger, muted, toggle }}>
      {children}
    </HapticsContext.Provider>
  );
}

export function useHaptics(): HapticsContextValue {
  const ctx = useContext(HapticsContext);
  if (!ctx) throw new Error("useHaptics must be used within HapticsProvider");
  return ctx;
}
