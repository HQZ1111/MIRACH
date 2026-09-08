/**
 * boot — 启动状态机（hermes store/boot.ts 移植，nanostores 原样）
 *
 * 单一可信启动状态源：phase 阶梯 + 单调进度 + 错误闩锁。
 * 启动页（GatewayConnectingOverlay/进度条）消费本 store 显示真实阶段，
 * 不再放假动画。mirach 适配：DesktopBootProgress 内联定义（hermes 在 global.d.ts），
 * 文案直接中文（无 i18n 层）。
 */

import { atom } from "nanostores";

/** hermes DesktopBootProgress（global.d.ts）— phase/progress/message 三要素 */
export interface DesktopBootProgress {
  phase: string;
  message: string;
  /** 单调递增（0-100）；allowDecrease 场景 hermes 侧处理，mirach 未用 */
  progress: number;
  running: boolean;
  fakeMode: boolean;
  error: string | null;
  timestamp: number;
}

export interface DesktopBootState extends DesktopBootProgress {
  visible: boolean;
}

const INITIAL_BOOT_STATE: DesktopBootState = {
  error: null,
  fakeMode: false,
  message: "正在启动 Mirach…",
  phase: "renderer.init",
  progress: 2,
  running: true,
  timestamp: Date.now(),
  visible: true,
};

export const $desktopBoot = atom<DesktopBootState>(INITIAL_BOOT_STATE);

function clampProgress(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function applyDesktopBootProgress(progress: DesktopBootProgress) {
  const current = $desktopBoot.get();
  const nextProgress = clampProgress(progress.progress);
  const mergedProgress = progress.running ? Math.max(current.progress, nextProgress) : nextProgress;

  // Don't let a late progress event (error: null) clobber a previously-set
  // boot failure — failDesktopBoot is terminal for this boot cycle.
  const error = progress.error ?? (current.running ? null : current.error);

  $desktopBoot.set({
    ...current,
    ...progress,
    error,
    progress: mergedProgress,
    visible: progress.running || mergedProgress < 100 || Boolean(error),
  });
}

export function setDesktopBootStep(step: {
  phase: string;
  message: string;
  progress: number;
  running?: boolean;
  fakeMode?: boolean;
  error?: string | null;
}) {
  const current = $desktopBoot.get();
  applyDesktopBootProgress({
    error: step.error ?? null,
    fakeMode: step.fakeMode ?? current.fakeMode,
    message: step.message,
    phase: step.phase,
    progress: step.progress,
    running: step.running ?? true,
    timestamp: Date.now(),
  });
}

/**
 * Re-arm the boot overlay for an automatic bounded retry of a failed boot.
 * Unlike setDesktopBootStep — whose null `error` intentionally cannot clear a
 * latched failure — this explicitly lifts the error so the overlay shows the
 * retry status instead of the terminal failure surface while the retry is in
 * flight. failDesktopBoot() re-latches when the bounded retries are exhausted.
 */
export function resumeDesktopBootForRetry(message: string) {
  const current = $desktopBoot.get();
  $desktopBoot.set({
    ...current,
    error: null,
    message,
    phase: "renderer.boot.retry",
    running: true,
    timestamp: Date.now(),
    visible: true,
  });
}

export function completeDesktopBoot(message = "已就绪") {
  const current = $desktopBoot.get();
  $desktopBoot.set({
    ...current,
    error: null,
    message,
    phase: "renderer.ready",
    progress: 100,
    running: false,
    timestamp: Date.now(),
    visible: false,
  });
}

export function failDesktopBoot(message: string) {
  const current = $desktopBoot.get();
  $desktopBoot.set({
    ...current,
    error: message,
    message: `启动失败：${message}`,
    phase: "renderer.error",
    progress: clampProgress(current.progress),
    running: false,
    timestamp: Date.now(),
    visible: true,
  });
}
