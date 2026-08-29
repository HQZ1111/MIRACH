/**
 * haptics — 触感反馈（复刻原型 haptics 按钮的机制）
 *
 * 桌面端没有 navigator.vibrate，与原型一致用 WebAudio 合成的"咔哒"点击声
 * 作为触感的听感替代。12 种交互意图各自映射一段振动序列（时长+强度），
 * 带限流防止连点风暴；静音状态持久化到 localStorage。
 */

// ===== 意图与振动段 =====

export type HapticIntent =
  | "cancel" | "close" | "crisp" | "error" | "open" | "selection"
  | "streamDone" | "streamStart" | "submit" | "success" | "tap" | "warning";

interface HapticSegment {
  duration: number;
  intensity: number; // 0..1
  delay: number;
}

const HAPTIC_PATTERNS: Record<HapticIntent, HapticSegment[]> = {
  cancel:       [{ duration: 12, intensity: 0.5, delay: 0 }, { duration: 10, intensity: 0.35, delay: 30 }],
  close:        [{ duration: 10, intensity: 0.5, delay: 0 }, { duration: 8, intensity: 0.3, delay: 18 }],
  crisp:        [{ duration: 10, intensity: 0.92, delay: 0 }],
  error:        [{ duration: 18, intensity: 0.9, delay: 0 }, { duration: 14, intensity: 0.7, delay: 40 }, { duration: 16, intensity: 0.8, delay: 60 }],
  open:         [{ duration: 8, intensity: 0.35, delay: 0 }, { duration: 10, intensity: 0.55, delay: 16 }],
  selection:    [{ duration: 16, intensity: 0.52, delay: 0 }],
  streamDone:   [{ duration: 8, intensity: 0.4, delay: 0 }, { duration: 10, intensity: 0.55, delay: 14 }, { duration: 12, intensity: 0.7, delay: 28 }],
  streamStart:  [{ duration: 10, intensity: 0.32, delay: 0 }],
  submit:       [{ duration: 8, intensity: 0.4, delay: 0 }, { duration: 12, intensity: 0.6, delay: 14 }],
  success:      [{ duration: 8, intensity: 0.35, delay: 0 }, { duration: 10, intensity: 0.5, delay: 14 }, { duration: 12, intensity: 0.65, delay: 28 }],
  tap:          [{ duration: 14, intensity: 0.58, delay: 0 }],
  warning:      [{ duration: 10, intensity: 0.6, delay: 0 }, { duration: 14, intensity: 0.75, delay: 24 }],
};

// ===== 静音状态（localStorage 持久化） =====

const MUTED_KEY = "mirach.hapticsMuted";

let muted = false;
try {
  muted = window.localStorage.getItem(MUTED_KEY) === "true";
} catch {
  /* 存储不可用时默认不静音 */
}

export function isHapticsMuted(): boolean {
  return muted;
}

export function setHapticsMuted(value: boolean) {
  muted = value;
  try {
    window.localStorage.setItem(MUTED_KEY, String(value));
  } catch {
    /* 忽略存储失败 */
  }
}

// ===== WebAudio 点击声 =====

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!audioCtx) {
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      audioCtx = Ctor ? new Ctor() : null;
    } catch {
      audioCtx = null;
    }
  }
  return audioCtx;
}

/** 播放一段"咔哒"点击声：噪声 burst + 带通滤波，音量随 intensity */
function playClick(at: number, intensity: number) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const duration = 0.02;
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    // 指数衰减的噪声
    data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2);
  }
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 4000;
  filter.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.value = 0.35 * intensity;
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(at);
}

// ===== 限流 =====

const SELECTION_RATE_MS = 50;
const GLOBAL_WINDOW_MS = 1000;
const GLOBAL_MAX = 5;

let recentTimestamps: number[] = [];

function rateLimited(intent: HapticIntent, source: string): boolean {
  const now = performance.now();
  if (intent === "selection") {
    const key = `sel:${source}`;
    const last = lastSelectionAtKey(key);
    if (now - last < SELECTION_RATE_MS) return true;
    setLastSelectionAt(key, now);
  }
  // 全局限流：1 秒窗口内最多 5 次
  recentTimestamps = recentTimestamps.filter((t) => now - t < GLOBAL_WINDOW_MS);
  if (recentTimestamps.length >= GLOBAL_MAX) return true;
  recentTimestamps.push(now);
  return false;
}

// selection 按源限流表（简易 Map，避免额外结构）
const selectionTimestamps = new Map<string, number>();
function lastSelectionAtKey(key: string): number {
  return selectionTimestamps.get(key) ?? 0;
}
function setLastSelectionAt(key: string, at: number) {
  selectionTimestamps.set(key, at);
  if (selectionTimestamps.size > 64) {
    const oldest = selectionTimestamps.keys().next().value;
    if (oldest !== undefined) selectionTimestamps.delete(oldest);
  }
}

// ===== 触发入口 =====

/**
 * 触发一次触感反馈。静音时静默；有 navigator.vibrate（移动端）走真震动，
 * 否则（桌面端）用 WebAudio 合成点击声。
 */
export function triggerHaptic(intent: HapticIntent, source = "global") {
  if (muted) return;
  if (rateLimited(intent, source)) return;

  const pattern = HAPTIC_PATTERNS[intent];
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    const ms = pattern.flatMap((s) => [s.duration, s.delay]);
    navigator.vibrate(ms);
    return;
  }

  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  const t0 = ctx.currentTime + 0.01;
  for (const seg of pattern) {
    playClick(t0 + seg.delay / 1000, seg.intensity);
  }
}

/** 预热 AudioContext（首次触发时避免 CoreAudio 启动卡顿） */
export function warmupHaptics() {
  if (typeof window === "undefined" || muted) return;
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "running") ctx.close().catch(() => undefined);
    });
  }
}
