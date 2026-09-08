/**
 * plugin-wake-word — 唤醒词插件（"hey hermes" 免提交 wake → 语音指令）
 *
 * 交互模型移植自 hermes 桌面端（apps/desktop/src/store/wake-word.ts）：
 *  - ear 开关即设置（persist），点击写 localStorage（mirach.wakeWord），
 *    下次启动自动恢复监听（hermes 的 auto-arm 语义）；
 *  - 监听独占麦克风：唤醒命中或手动听写占用麦克风时，唤醒监听让位，
 *    麦克风释放后自动恢复（hermes 的 mic lease / wake.resume 语义）；
 *  - 唤醒命中 → 自动开始听写（一句话指令），说完自动发送 → 恢复监听
 *    （hermes 的 wake.detected → voice → start_new_session 语义收窄为
 *    "当前会话发送"，不开新会话）。
 *
 * 检测引擎适配：hermes 引擎侧跑 openWakeWord/sherpa（Python 后端），
 * mirach 的后端是 dsh sidecar（无 wake.* RPC、无音频通道），而 webview
 * 里已有听写用的 Web Speech 链路——本插件在渲染进程内用连续识别做
 * 关键词匹配（hey hermes / 嘿 hermes / hey mirach 等变体），全程本地、
 * 无音频出端。改动点集中在：composer-extras 的 WakeToggle 消费本 store。
 *
 * 插件形态：模块导入即注册（与 plugin-environments 同惯例），
 * App.tsx side-effect import。
 */

import { atom } from "nanostores";
import { registerPlugin } from "@/plugins/registry";
import { pushToast } from "@/store/toast";
import { isVoiceStopCommand } from "@/lib/voice-stop-word";

// ── 状态（hermes $wakeWord 的同构简化版） ─────────────────────────────────────

export interface WakeWordState {
  /** 设置真值（localStorage 持久；hermes wake_word.enabled） */
  enabled: boolean;
  /** 监听已武装（当前由本插件持有识别循环） */
  listening: boolean;
  /** 最近一次失败原因/提示（tooltip 用；hermes notice） */
  notice: string;
  /** 展示用唤醒短语 */
  phrase: string;
}

const ENABLED_KEY = "mirach.wakeWord"; // 历史键：WakeToggle 原持久化位，沿用
const PHRASE_KEY = "mirach.wakeWord.phrase";
const DEFAULT_PHRASE = "hey hermes";

function readEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "on"; } catch { return false; }
}

function readPhrase(): string {
  try {
    const p = (localStorage.getItem(PHRASE_KEY) ?? "").trim();
    return p || DEFAULT_PHRASE;
  } catch { return DEFAULT_PHRASE; }
}

export const $wakeWord = atom<WakeWordState>({
  enabled: readEnabled(),
  listening: false,
  notice: "",
  phrase: readPhrase(),
});

function setWake(patch: Partial<WakeWordState>): void {
  $wakeWord.set({ ...$wakeWord.get(), ...patch });
}

/** 更换唤醒短语（持久化 + 变体表自动跟随；唤醒按钮右键菜单调用） */
export function setWakePhrase(phrase: string): string {
  const clean = phrase.trim() || DEFAULT_PHRASE;
  try { localStorage.setItem(PHRASE_KEY, clean); } catch { /* ignore */ }
  setWake({ phrase: clean });
  // 监听中的识别循环下个周期重建候选词（stopEngine→startEngine 保持 armed 语义）
  if (armed && recognition !== null) {
    stopEngine();
    if (!micLease) startEngine();
  }
  return clean;
}

// ── 唤醒短语匹配（大小写/空格/标点归一 + 中文谐音变体） ─────────────────────────

const ZH_VARIANTS: Record<string, string[]> = {
  "heyhermes": ["嘿hermes", "嗨hermes", "嘿 Hermes", "hey mirach", "嘿mirach"],
  "heymirach": ["嘿mirach", "嘿 hermes", "heyhermes"],
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[\s.,!?，。！？、'"'"·]/g, "");
}

/** 归一后的候选词：短语本身 + 短语的中文谐音变体 */
function wakeCandidates(phrase: string): string[] {
  const norm = normalize(phrase);
  const extra = ZH_VARIANTS[norm] ?? [];
  return [norm, ...extra.map(normalize)];
}

function transcriptHitsWake(transcript: string, candidates: string[]): boolean {
  const norm = normalize(transcript);
  return candidates.some((c) => c !== "" && norm.includes(c));
}

// ── 识别循环（连续识别 + onend 自动重启；麦克风租约让位） ──────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;
/** 设置真值驱动的监听意愿（enabled 且未被麦克风租约挡住时保持 armed） */
let armed = false;
/** 麦克风租约：听写/唤醒后的一句话指令占用期间，唤醒识别让位 */
let micLease = false;
/** 唤醒命中后的一次性指令模式：该轮听写定稿后自动发送一次 */
let oneShotSend = false;
let restartTimer = 0;

function stopEngine(): void {
  if (restartTimer) { window.clearTimeout(restartTimer); restartTimer = 0; }
  try { recognition?.stop(); } catch { /* ignore */ }
  recognition = null;
}

function startEngine(): void {
  if (!armed || micLease || recognition !== null) return;
  const w = window as unknown as Record<string, unknown>;
  const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        maxAlternatives: number;
        onresult: ((e: Event) => void) | null;
        onend: (() => void) | null;
        onerror: ((e: Event) => void) | null;
        start(): void;
        stop(): void;
      })
    | undefined;
  if (!SR) {
    armed = false;
    setWake({ enabled: false, listening: false, notice: "当前环境不支持语音识别，唤醒词不可用" });
    return;
  }
  try {
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    const candidates = wakeCandidates($wakeWord.get().phrase);
    rec.onresult = (e: Event) => {
      const results = (e as unknown as { results: ArrayLike<{ 0: { transcript: string } }> }).results;
      let text = "";
      for (let i = 0; i < results.length; i++) text += results[i][0].transcript;
      // 只看尾窗（结果列表是累计的，长会话里全量拼接越来越长）
      const tail = text.slice(-160);
      if (transcriptHitsWake(tail, candidates)) wakeDetected();
    };
    rec.onend = () => {
      recognition = null;
      // 浏览器会因静音/时长自动断流：armed 语义下自动重启，监听永不掉线
      if (armed && !micLease) restartTimer = window.setTimeout(startEngine, 400);
    };
    rec.onerror = (e: Event) => {
      const err = (e as unknown as { error?: string }).error;
      if (err === "not-allowed" || err === "service-not-allowed") {
        // 麦克风权限被拒：停用并给原因（hermes notice 语义）
        armed = false;
        recognition = null;
        setWake({ enabled: false, listening: false, notice: "麦克风权限被拒绝，唤醒词不可用" });
      }
      // 其余错误（no-speech/aborted/network）交给 onend 的重启循环
    };
    recognition = rec;
    rec.start();
    setWake({ listening: true, notice: "" });
  } catch {
    recognition = null;
    if (armed && !micLease) restartTimer = window.setTimeout(startEngine, 800);
  }
}

/** 唤醒命中：让出麦克风 → 提示 → 自动进入听写（一句话指令） */
function wakeDetected(): void {
  stopEngine();
  oneShotSend = true;
  setWake({ listening: false });
  pushToast("已唤醒，请说指令");
  // 唤醒提示音（plugin-sound-cues 消费；hermes wake.detected → chime 同款）
  window.dispatchEvent(new CustomEvent("mirach:sound-cue", { detail: "wake" }));
  // 复用听写链路（composer-extras 的单例引擎）：覆盖层/按钮语义一致
  window.dispatchEvent(new CustomEvent("mirach:voice-request"));
}

// ── 麦克风租约与一句话指令的自动发送（window 事件解耦，与官方树零耦合） ──────────

/** 听写状态广播（composer-extras setDictation 派发）：占用/释放麦克风 */
function onDictationActive(e: Event): void {
  const active = Boolean((e as CustomEvent<boolean>).detail);
  micLease = active;
  if (active) {
    stopEngine();
    setWake({ listening: false });
  } else {
    if (armed) restartTimer = window.setTimeout(startEngine, 500);
  }
}

/** 该轮听写定稿（mirach:dictation-text）：one-shot 模式下自动发送一次。
 *  整句是停止命令（"停止/不用了/再见…"，hermes voice-stop-word 语义）→
 *  不发送、结束本轮（监听经 dictation-active=false 自动恢复）。 */
function onDictationFinal(e: Event): void {
  if (!oneShotSend) return;
  const text = String((e as CustomEvent<string>).detail ?? "");
  if (isVoiceStopCommand(text)) {
    oneShotSend = false;
    pushToast("语音已结束");
    return;
  }
  oneShotSend = false;
  // 稍候一拍：Lexical 把 final 增量同步进 input machine 后发送键才可用
  window.setTimeout(() => {
    const card = document.querySelector("[data-composer-card]");
    const buttons = card
      ? Array.from(card.querySelectorAll<HTMLButtonElement>("button[class*='_primary']"))
      : [];
    const send = buttons.length > 0 ? buttons[buttons.length - 1] : null;
    if (send && !send.disabled) send.click();
  }, 350);
}

/** 发送完成/失败后恢复监听（hermes wake.resume 语义的客户端版） */
function onSessionTurnSettled(): void {
  if (armed && !micLease && recognition === null) startEngine();
}

let wired = false;

function ensureWiring(): void {
  if (wired) return;
  wired = true;
  window.addEventListener("mirach:dictation-active", onDictationActive as EventListener);
  window.addEventListener("mirach:dictation-text", onDictationFinal);
  // 发送/轮次落定信号：MainPanel 的发送链路会派发（见下），这里只做恢复
  window.addEventListener("mirach:wake-resume", onSessionTurnSettled);
  window.addEventListener("mirach:turn-settled", onSessionTurnSettled);
}

// ── 对外动作（composer-extras 的 ear 按钮消费） ────────────────────────────────

/** ear 开关：启停监听并持久化（toggle 即设置，hermes persist: true 语义） */
export function toggleWakeWord(): void {
  const s = $wakeWord.get();
  const nextEnabled = !s.enabled;
  try { localStorage.setItem(ENABLED_KEY, nextEnabled ? "on" : "off"); } catch { /* ignore */ }
  ensureWiring();
  if (nextEnabled) {
    armed = true;
    oneShotSend = false;
    // 首次武装提示（hermes：首次可能要装引擎；这里给个可感知的即时反馈）
    setWake({ enabled: true, notice: "", listening: false });
    startEngine();
  } else {
    armed = false;
    oneShotSend = false;
    stopEngine();
    setWake({ enabled: false, listening: false, notice: "" });
  }
}

/** 启动自动恢复：enabled=true（历史开关开着）即自动武装（hermes auto-arm） */
export function armWakeWord(): void {
  if (!readEnabled()) return;
  ensureWiring();
  armed = true;
  startEngine();
}

// ── 插件注册（导入即注册；扩展列表可见） ───────────────────────────────────────

registerPlugin({
  id: "plugin-wake-word",
  name: "唤醒词（hey hermes）",
  version: "0.1.0",
});

// 模块加载：接线 + 历史开关为 on 时自动武装
ensureWiring();
if (readEnabled()) {
  armed = true;
  // 等官方输入树挂好后启动（识别本身不依赖 DOM，晚一点无妨）
  window.setTimeout(() => { if (armed && !micLease) startEngine(); }, 2000);
}
