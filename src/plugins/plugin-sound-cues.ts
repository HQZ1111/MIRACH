/**
 * plugin-sound-cues — 提示音插件（整库移植自 hermes 桌面端的声音系统）
 *
 * hermes 的 UI 提示音全部是 WebAudio 现场合成（振荡器 + 包络 + 混响），
 * 零音频素材文件，本插件把声音库原样搬来：
 *  - audio-context：全应用共享一个 AudioContext（懒创建 + autoplay 恢复）；
 *  - completion-sound：14 种回合完成提示音（两音舒适/玻璃叮/马林巴/三音
 *    消息/气声/发现簇/系统上线/IBM 终端/调制解调器/风铃/颂钵/竖琴/声呐/
 *    音乐盒），voices → master → lowpass → dry+reverb 信号链；
 *  - wake-sound：唤醒命中上行双音（G5→C6，"开始听"），与完成音（下行，
 *    "结束"）刻意区分；
 *  - thinking-sound：流式工作期间的轻柔气泡音循环（G4/E4 交替，0.8~1.2s
 *    随机间隔），默认关（hermes 里是语音对话专用的"没死"心跳）。
 *
 * mirach 挂点（hermes 的 message.complete → $aiStreaming 下降沿）：
 *  - $aiStreaming true→false：回合结束 → 完成音（800ms 去重防连响）；
 *  - $aiStreaming false→true：回合开始 → 思考气泡音开（设置开时）；
 *  - window "mirach:sound-cue"（detail: "wake"|"complete"|"error"）：事件
 *    面给其他插件（plugin-wake-word 唤醒命中发 "wake"）。
 * 多窗口去重：Web Locks（hermes ownsAmbientCue 同款思路），多开会话窗口
 * 只有一个响。
 *
 * 设置面：顶栏工具菜单（toolMenu）——试听 / 切换完成音变体 / 静音开关；
 * 持久化 localStorage：mirach.soundCues.variant / thinking；静音 = 顶栏触感按钮（mirach.hapticsMuted）。
 */

import { atom } from "nanostores";
import { registerPlugin } from "@/plugins/registry";
import { $aiStreaming } from "@/store/chat";
import { pushToast } from "@/store/toast";
import { isHapticsMuted, setHapticsMuted } from "@/lib/haptics";

// ── 共享 AudioContext（hermes lib/audio-context.ts 原样移植） ─────────────────

let ctx: AudioContext | null = null;

/** 共享 AudioContext；WebAudio 不可用返回 null */
function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // autoplay 策略可能让 context 挂起；用户交互过之后 resume 可恢复
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

// ── 合成声部（hermes lib/completion-sound.ts 原样移植） ───────────────────────

type OscType = OscillatorType;

interface ToneSpec { attack?: number; dur: number; freq: number; gain?: number; start?: number; type?: OscType }
interface PluckSpec { attack?: number; decay: number; freqFrom: number; freqTo: number; gain: number; glide?: number; start?: number }
interface BloomSpec { attack: number; decay: number; detune?: number; freq: number; freqTo?: number; gain: number; hold?: number; start?: number; type?: OscType }
interface AirPuffSpec { decay: number; freq: number; gain: number; q?: number; start?: number }
interface WhooshSpec { decay: number; freqFrom: number; freqTo: number; gain: number; q?: number; start?: number }
interface SweepSpec { attack?: number; decay: number; freqFrom: number; freqTo: number; gain: number; start?: number; type?: OscType }

/** 一条包络振荡器声部 → master。线性起音 + 指数衰减，尾部平滑无咔哒。 */
function voice(ac: AudioContext, master: GainNode, t0: number, spec: ToneSpec): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const peak = spec.gain ?? 0.5;
  const attack = spec.attack ?? 0.006;
  const end = start + spec.dur;
  osc.type = spec.type ?? "sine";
  osc.frequency.setValueAtTime(spec.freq, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** 软拨弦：短三角波起振 + 上行滑入余晖。 */
function pluckVoice(ac: AudioContext, master: GainNode, t0: number, spec: PluckSpec): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const attack = spec.attack ?? 0.004;
  const glide = spec.glide ?? 0.16;
  const end = start + spec.decay;
  osc.type = "triangle";
  osc.frequency.setValueAtTime(spec.freqFrom, start);
  osc.frequency.exponentialRampToValueAtTime(spec.freqTo, start + glide);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(spec.gain, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** 慢起泛音绽放——拨弦后的余晖尾。 */
function bloomVoice(ac: AudioContext, master: GainNode, t0: number, spec: BloomSpec): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const hold = spec.hold ?? 0.08;
  const end = start + spec.attack + hold + spec.decay;
  osc.type = spec.type ?? "sine";
  osc.frequency.setValueAtTime(spec.freq, start);
  if (spec.freqTo) {
    osc.frequency.exponentialRampToValueAtTime(spec.freqTo, start + spec.attack + hold * 0.6);
  }
  osc.detune.setValueAtTime(spec.detune ?? 0, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(spec.gain, 0.0002), start + spec.attack);
  env.gain.setValueAtTime(Math.max(spec.gain, 0.0002), start + spec.attack + hold);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
}

function noiseSource(ac: AudioContext, seconds: number): AudioBufferSourceNode {
  const length = Math.floor(ac.sampleRate * seconds);
  const buffer = ac.createBuffer(1, length, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  const source = ac.createBufferSource();
  source.buffer = buffer;
  return source;
}

/** 一丝带通噪声（PS5 菜单式的空气感）。 */
function airPuff(ac: AudioContext, master: GainNode, t0: number, spec: AirPuffSpec): void {
  const source = noiseSource(ac, 0.12);
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const end = start + spec.decay;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(spec.freq, start);
  filter.Q.setValueAtTime(spec.q ?? 1.2, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(spec.gain, 0.0002), start + 0.018);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(filter);
  filter.connect(env);
  env.connect(master);
  source.start(start);
  source.stop(end + 0.02);
}

/** 带通噪声扫频——柔和的送气/嗖声。 */
function whooshVoice(ac: AudioContext, master: GainNode, t0: number, spec: WhooshSpec): void {
  const source = noiseSource(ac, 0.4);
  const filter = ac.createBiquadFilter();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const end = start + spec.decay;
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(spec.freqFrom, start);
  filter.frequency.exponentialRampToValueAtTime(spec.freqTo, end);
  filter.Q.setValueAtTime(spec.q ?? 0.8, start);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(spec.gain, 0.0002), start + 0.03);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  source.connect(filter);
  filter.connect(env);
  env.connect(master);
  source.start(start);
  source.stop(end + 0.02);
}

/** 扫频啁啾——调制解调器/科幻感。 */
function sweepVoice(ac: AudioContext, master: GainNode, t0: number, spec: SweepSpec): void {
  const osc = ac.createOscillator();
  const env = ac.createGain();
  const start = t0 + (spec.start ?? 0);
  const attack = spec.attack ?? 0.003;
  const end = start + spec.decay;
  osc.type = spec.type ?? "triangle";
  osc.frequency.setValueAtTime(spec.freqFrom, start);
  osc.frequency.exponentialRampToValueAtTime(spec.freqTo, end - 0.02);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(spec.gain, 0.0002), start + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(end + 0.02);
}

let reverbImpulse: AudioBuffer | null = null;

/** 轻微湿声，让叮声有房间感而不是铁罐感。脉冲只生成一次并缓存。 */
function makeReverb(ac: AudioContext): ConvolverNode {
  if (!reverbImpulse) {
    const seconds = 1.6;
    const length = Math.floor(ac.sampleRate * seconds);
    reverbImpulse = ac.createBuffer(2, length, ac.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = reverbImpulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
      }
    }
  }
  const convolver = ac.createConvolver();
  convolver.buffer = reverbImpulse;
  return convolver;
}

// ── 14 种完成音变体（hermes COMPLETION_SOUND_VARIANTS 原样移植） ──────────────

export interface CompletionSoundVariant {
  id: number;
  name: string;
  play: (ac: AudioContext, master: GainNode, t0: number) => void;
}

const A2 = 110, A3 = 220, A4 = 440, A5 = 880, B5 = 987.77, C3 = 130.81, C4 = 261.63,
  E4 = 329.63, E5 = 659.25, E6 = 1318.51, G4 = 392, G5 = 783.99, C5 = 523.25, C6 = 1046.5;

export const COMPLETION_SOUND_VARIANTS: readonly CompletionSoundVariant[] = [
  {
    id: 1, name: "两音安慰",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: E4, dur: 0.22, gain: 0.05, attack: 0.03, type: "sine" });
      voice(ac, master, t0 + 0.08, { freq: C4, dur: 0.52, gain: 0.07, attack: 0.08, type: "sine" });
      voice(ac, master, t0 + 0.08, { freq: C3, dur: 0.46, gain: 0.02, attack: 0.1, type: "sine" });
    },
  },
  {
    id: 2, name: "玻璃叮",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: C6, dur: 0.55, gain: 0.032, attack: 0.002, type: "sine" });
      voice(ac, master, t0 + 0.01, { freq: E5, dur: 0.42, gain: 0.018, attack: 0.004, type: "sine" });
      airPuff(ac, master, t0, { freq: 3200, gain: 0.004, decay: 0.1, q: 1.4 });
    },
  },
  {
    id: 3, name: "柔马林巴",
    play: (ac, master, t0) => {
      pluckVoice(ac, master, t0, { freqFrom: E5, freqTo: G5, gain: 0.03, decay: 0.14, glide: 0.08 });
      bloomVoice(ac, master, t0 + 0.04, { freq: C5, gain: 0.028, attack: 0.08, hold: 0.04, decay: 0.62 });
      bloomVoice(ac, master, t0 + 0.06, { freq: G4, gain: 0.014, attack: 0.12, hold: 0.06, decay: 0.55 });
    },
  },
  {
    id: 4, name: "三音消息",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: C6, dur: 0.14, gain: 0.045, attack: 0.004, type: "sine" });
      voice(ac, master, t0 + 0.1, { freq: A5, dur: 0.16, gain: 0.04, attack: 0.004, type: "sine" });
      voice(ac, master, t0 + 0.2, { freq: G5, dur: 0.22, gain: 0.035, attack: 0.006, type: "sine" });
    },
  },
  {
    id: 5, name: "气声嗖",
    play: (ac, master, t0) => {
      whooshVoice(ac, master, t0, { freqFrom: 4200, freqTo: 900, gain: 0.022, decay: 0.28, q: 0.7 });
      voice(ac, master, t0 + 0.12, { freq: A5, dur: 0.35, gain: 0.02, attack: 0.02, type: "sine" });
    },
  },
  {
    id: 6, name: "发现簇",
    play: (ac, master, t0) => {
      const clusterDetunes = [-14, -5, 0, 7, 12];
      clusterDetunes.forEach((detune, i) => {
        bloomVoice(ac, master, t0 + i * 0.03, { freq: A3, gain: 0.012, attack: 0.38, hold: 0.12, decay: 1.05, detune });
      });
      bloomVoice(ac, master, t0 + 0.1, { freq: E4, gain: 0.008, attack: 0.45, hold: 0.08, decay: 0.9, detune: 3 });
    },
  },
  {
    id: 7, name: "系统上线",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: C5, dur: 0.16, gain: 0.04, attack: 0.006, type: "sine" });
      voice(ac, master, t0 + 0.09, { freq: G5, dur: 0.28, gain: 0.042, attack: 0.008, type: "sine" });
      voice(ac, master, t0 + 0.09, { freq: C4, dur: 0.24, gain: 0.012, attack: 0.01, type: "sine" });
    },
  },
  {
    id: 8, name: "IBM 终端",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: B5, dur: 0.12, gain: 0.038, attack: 0.002, type: "square" });
      voice(ac, master, t0 + 0.14, { freq: E5, dur: 0.1, gain: 0.028, attack: 0.002, type: "square" });
    },
  },
  {
    id: 9, name: "调制解调器",
    play: (ac, master, t0) => {
      sweepVoice(ac, master, t0, { freqFrom: 320, freqTo: 2200, gain: 0.024, decay: 0.16, type: "triangle" });
      sweepVoice(ac, master, t0 + 0.1, { freqFrom: 480, freqTo: 1400, gain: 0.014, decay: 0.12, type: "sine" });
    },
  },
  {
    id: 10, name: "风铃",
    play: (ac, master, t0) => {
      const chimes = [G5, C6, E5, A5];
      chimes.forEach((frequency, i) => {
        voice(ac, master, t0 + i * 0.13, { freq: frequency, dur: 0.72, gain: 0.028 - i * 0.003, attack: 0.003, type: "sine" });
      });
    },
  },
  {
    id: 11, name: "颂钵",
    play: (ac, master, t0) => {
      bloomVoice(ac, master, t0, { freq: A3, gain: 0.022, attack: 0.58, hold: 0.16, decay: 1.35 });
      bloomVoice(ac, master, t0 + 0.08, { freq: E4, gain: 0.01, attack: 0.62, hold: 0.12, decay: 1.2, detune: 4 });
      bloomVoice(ac, master, t0 + 0.14, { freq: A4, gain: 0.006, attack: 0.68, hold: 0.08, decay: 1.05, detune: -3 });
    },
  },
  {
    id: 12, name: "竖琴上扬",
    play: (ac, master, t0) => {
      const notes = [C5, E5, G5, C6];
      notes.forEach((frequency, i) => {
        voice(ac, master, t0 + i * 0.075, { freq: frequency, dur: 0.38, gain: 0.034 - i * 0.004, attack: 0.012, type: "sine" });
      });
      bloomVoice(ac, master, t0 + 0.2, { freq: C4, gain: 0.01, attack: 0.18, hold: 0.06, decay: 0.7 });
    },
  },
  {
    id: 13, name: "声呐",
    play: (ac, master, t0) => {
      voice(ac, master, t0, { freq: A2, dur: 0.95, gain: 0.036, attack: 0.008, type: "sine" });
      voice(ac, master, t0 + 0.42, { freq: A3, dur: 0.55, gain: 0.014, attack: 0.01, type: "sine" });
      airPuff(ac, master, t0, { freq: 600, gain: 0.005, decay: 0.2, q: 0.5 });
    },
  },
  {
    id: 14, name: "音乐盒",
    play: (ac, master, t0) => {
      const notes = [E6, C6, G5, E5];
      notes.forEach((frequency, i) => {
        pluckVoice(ac, master, t0 + i * 0.09, { freqFrom: frequency, freqTo: frequency * 0.998, gain: 0.02 - i * 0.002, decay: 0.2, glide: 0.06 });
      });
    },
  },
] as const;

// ── 持久化状态（hermes store/completion-sound + store/haptics + voice-prefs） ─

const VARIANT_KEY = "mirach.soundCues.variant";
const THINKING_KEY = "mirach.soundCues.thinking";

function readInt(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch { return fallback; }
}

function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === "1";
  } catch { return fallback; }
}

function writeKey(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}

export interface SoundCuesState {
  /** 完成音变体 id（1~14） */
  variant: number;
  /** 思考中气泡音（默认关） */
  thinking: boolean;
}

/** 静音开关 = 顶栏"触感反馈"按钮（lib/haptics 的 mirach.hapticsMuted，
 *  hermes $hapticsMuted 同一个开关管触感 + 全部提示音），此处不另设键。 */
export const $soundCues = atom<SoundCuesState>({
  variant: readInt(VARIANT_KEY, 1),
  thinking: readBool(THINKING_KEY, false),
});

function setCues(patch: Partial<SoundCuesState>): void {
  $soundCues.set({ ...$soundCues.get(), ...patch });
}

export function setCompletionVariant(id: number): void {
  const variant = COMPLETION_SOUND_VARIANTS.find((v) => v.id === id) ?? COMPLETION_SOUND_VARIANTS[0];
  writeKey(VARIANT_KEY, String(variant.id));
  setCues({ variant: variant.id });
}

export function setSoundCuesMuted(muted: boolean): void {
  setHapticsMuted(muted);
}

export function setThinkingSound(enabled: boolean): void {
  writeKey(THINKING_KEY, enabled ? "1" : "0");
  setCues({ thinking: enabled });
  if (!enabled) stopThinkingSound();
}

// ── 播放（hermes playVariant 信号链原样） ─────────────────────────────────────

function playVariant(variantId: number): void {
  const variant = COMPLETION_SOUND_VARIANTS.find((v) => v.id === variantId);
  if (!variant) return;
  const ac = getAudioContext();
  if (!ac) return;
  // 声部 → master → 低通 → (干声 + 混响湿声) → 输出
  const master = ac.createGain();
  const tone = ac.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.setValueAtTime(3800, ac.currentTime);
  tone.Q.setValueAtTime(0.32, ac.currentTime);
  master.gain.setValueAtTime(0.48, ac.currentTime);
  master.connect(tone);

  const dry = ac.createGain();
  dry.gain.setValueAtTime(0.88, ac.currentTime);
  tone.connect(dry);
  dry.connect(ac.destination);

  const reverb = makeReverb(ac);
  const wet = ac.createGain();
  wet.gain.setValueAtTime(0.34, ac.currentTime);
  tone.connect(reverb);
  reverb.connect(wet);
  wet.connect(ac.destination);

  variant.play(ac, master, ac.currentTime + 0.01);
}

/** 设置页/菜单试听：绕过静音开关（hermes previewCompletionSound 语义） */
export function previewCompletionSound(variantId?: number): void {
  const id = variantId ?? $soundCues.get().variant;
  playVariant(COMPLETION_SOUND_VARIANTS.find((v) => v.id === id)?.id ?? 1);
}

// ── 多窗口去重（hermes ownsAmbientCue 的 Web Locks 简化版） ───────────────────

/** 抢到锁的窗口才响（多开会话窗口只出一个声音）；Web Locks 不可用就直接响 */
function playIfAmbientOwner(key: string, play: () => void): void {
  const locks = (navigator as unknown as { locks?: LockManager }).locks;
  if (!locks?.request) {
    play();
    return;
  }
  void locks
    .request(`mirach-sound-cue:${key}`, { ifAvailable: true }, async (lock) => {
      if (!lock) return;
      play();
      // 短持有：同 key 的连续触发仍归本窗口
      await new Promise((r) => window.setTimeout(r, 400));
    })
    .catch(() => undefined);
}

// ── 各提示音入口 ──────────────────────────────────────────────────────────────

let lastCompletionAt = 0;

/** 回合完成叮声（$aiStreaming 下降沿 / 事件面；静音与去重先行） */
export function playCompletionCue(dedupeKey?: string): void {
  if (isHapticsMuted()) return;
  const now = Date.now();
  if (now - lastCompletionAt < 800) return; // 下降沿连发去重
  lastCompletionAt = now;
  playIfAmbientOwner(dedupeKey ?? "completion", () => playVariant($soundCues.get().variant));
}

/** 唤醒命中上行双音（hermes wake-sound 原样：G5→C6，"开始听"） */
export function playWakeCue(): void {
  if (isHapticsMuted()) return;
  const ac = getAudioContext();
  if (!ac) return;
  try {
    const master = ac.createGain();
    master.gain.setValueAtTime(0.5, ac.currentTime);
    master.connect(ac.destination);
    const ding = (t0: number, freq: number, dur: number, gain: number) => {
      const osc = ac.createOscillator();
      const env = ac.createGain();
      const end = t0 + dur;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0);
      env.gain.setValueAtTime(0.0001, t0);
      env.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(env);
      env.connect(master);
      osc.start(t0);
      osc.stop(end + 0.02);
    };
    const t0 = ac.currentTime + 0.01;
    ding(t0, 783.99, 0.12, 0.06);
    ding(t0 + 0.1, 1046.5, 0.28, 0.07);
  } catch {
    /* 声音失败绝不打断唤醒处理 */
  }
}

// ── 思考中气泡音循环（hermes thinking-sound 原样移植） ────────────────────────

let thinkingTimer: number | null = null;
let blipIndex = 0;

/** 一声轻"噗"：短正弦 + 下行滑频，无咔哒、刻意安静。 */
function blub(ac: AudioContext, freq: number): void {
  const t0 = ac.currentTime + 0.01;
  const dur = 0.16;
  const osc = ac.createOscillator();
  const env = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(freq * 0.72, t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env);
  env.connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export function startThinkingSound(): void {
  if (thinkingTimer !== null || !$soundCues.get().thinking || isHapticsMuted()) return;
  const tick = () => {
    if (!isHapticsMuted()) {
      const ac = getAudioContext();
      if (ac) {
        try {
          blub(ac, blipIndex % 2 === 0 ? 392 : 329.6); // G4 / E4 交替
        } catch { /* 声音后端不可用保持静默 */ }
      }
    }
    blipIndex += 1;
    thinkingTimer = window.setTimeout(tick, 800 + Math.random() * 400);
  };
  thinkingTimer = window.setTimeout(tick, 400);
}

export function stopThinkingSound(): void {
  if (thinkingTimer !== null) {
    window.clearTimeout(thinkingTimer);
    thinkingTimer = null;
  }
}

// ── mirach 挂点：回合生命周期 + 事件面 ────────────────────────────────────────

let wired = false;

function ensureWiring(): void {
  if (wired) return;
  wired = true;
  // $aiStreaming 下降沿 = 回合结束（complete/error/Stop 都经 finalize 复位）→ 完成音
  let wasStreaming = $aiStreaming.get();
  $aiStreaming.subscribe((streaming) => {
    if (wasStreaming && !streaming) {
      stopThinkingSound();
      playCompletionCue();
    } else if (!wasStreaming && streaming) {
      startThinkingSound();
    }
    wasStreaming = streaming;
  });
  // 事件面：其他插件/模块派发具名提示音（plugin-wake-word 发 "wake"）
  window.addEventListener("mirach:sound-cue", (e) => {
    const kind = (e as CustomEvent<string>).detail;
    if (kind === "wake") playWakeCue();
    else if (kind === "complete") playCompletionCue("event");
  });
}

// ── 插件注册 + 顶栏工具菜单控制面 ─────────────────────────────────────────────

registerPlugin({
  id: "plugin-sound-cues",
  name: "提示音（hermes 声音库）",
  version: "0.1.0",
  toolMenu: [
    {
      id: "sound-cues-preview",
      label: "试听完成音",
      icon: "sparkles",
      run: () => previewCompletionSound(),
    },
    {
      id: "sound-cues-next-variant",
      label: "切换完成音变体",
      icon: "star",
      run: () => {
        const cur = $soundCues.get().variant;
        const idx = COMPLETION_SOUND_VARIANTS.findIndex((v) => v.id === cur);
        const next = COMPLETION_SOUND_VARIANTS[(idx + 1) % COMPLETION_SOUND_VARIANTS.length];
        setCompletionVariant(next.id);
        pushToast(`完成音：${next.name}（${next.id}/${COMPLETION_SOUND_VARIANTS.length}）`);
        previewCompletionSound(next.id);
      },
    },
    {
      id: "sound-cues-toggle-muted",
      label: "提示音静音/取消静音",
      icon: "log",
      run: () => {
        const next = !isHapticsMuted();
        setSoundCuesMuted(next);
        pushToast(next ? "提示音已静音" : "提示音已开启");
      },
    },
  ],
});

// 模块加载：接线 + 变体合法性兜底
ensureWiring();
if (!COMPLETION_SOUND_VARIANTS.some((v) => v.id === $soundCues.get().variant)) {
  setCues({ variant: 1 });
}
