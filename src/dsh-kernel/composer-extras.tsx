/**
 * composer-extras — 把 mirach 输入框特有控件注入官方 InputBar 的子槽位
 *
 * 官方输入条（ui-conversation InputBar）声明了 conversation.input.left /
 * right 子槽（left = 工具组、right = 模型/发送组）。本模块把 mirach 有、
 * 官方没有的输入框控件以官方槽位条目形态注册进去。
 *
 * 注入布局（用户指定，从右往左 = 发送 → 唤醒 → 朗读 → 听写 → 模型 → 用量）：
 *   left 工具组:  +号(built-in) → 权限预设(official) → 终端(our)
 *   right 尾组:   用量(official, CSS order 前移) → 模型(official) → 听写(our) → 朗读(our) → 唤醒(our) → 发送(built-in)
 *
 * 组件本体保持 mirach 实现（nanostores/lucide 在同一 React 树），只借官方
 * 槽位获得官方排布与主题令牌（容器由官方渲染，无需自挂 DSW alias）。
 *
 * 听写接线：识别结果经 insertIntoComposer 写入官方编辑器
 * （[data-composer-card] 的 contenteditable，走 execCommand 让 Lexical
 * 捕获 beforeinput 同步 input machine 草稿）；空输入点击发送=语音的行为
 * 由 OfficialVoiceSend 覆盖层实现（官方 InputBar 空态时主按钮 disabled，
 * 覆盖层透出话筒并把点击转为 "mirach:voice-request"——官方源码零改动）。
 */

import { useEffect, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { useStore } from "@nanostores/react";
import { Ear, EarOff, Mic, Square, TerminalSquare, Volume2, VolumeX } from "lucide-react";
import { $autoSpeak } from "@/store/chat";
import { $wakeWord, toggleWakeWord } from "@/plugins/plugin-wake-word";
import { logInfo, logWarn } from "./kernel-log";

/** 官方工具行 ghost 按钮的 mirach 视觉（对齐 mirach Composer GHOST_ICON_BTN）。
 *  末位是**稳定标记类**：HUD 模式要按它把 mirach 注入的这几个按钮（终端/听写/朗读/唤醒词）
 *  藏起来（hermes 的 HUD 同样只留 composer 本体，micro-action pills 不进悬浮条），
 *  也让 CSS 不必去猜 title（title 会随状态变：开启/关闭朗读、听写/停止听写…）。 */
const EXTRA_BTN =
  "mirach-composer-extra flex h-8 w-8 items-center justify-center rounded-lg text-[#464646] transition-colors hover:bg-black/5";

// ── 听写引擎（模块级单例：工具行按钮与"空输入点发送=语音"共用一条链） ────────

type DictationState = { active: boolean };
const dictationListeners = new Set<(s: DictationState) => void>();
let dictationState: DictationState = { active: false };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let recognition: any = null;

function setDictation(active: boolean): void {
  dictationState = { active };
  for (const fn of dictationListeners) fn(dictationState);
  // 麦克风租约广播：唤醒词插件在听写期间让位、结束后自动恢复监听
  window.dispatchEvent(new CustomEvent("mirach:dictation-active", { detail: active }));
}

/** 把文本插入官方输入框编辑器（focus + execCommand，Lexical 经 beforeinput 同步草稿） */
function insertIntoComposer(text: string): void {
  if (!text) return;
  const el = document.querySelector<HTMLDivElement>(
    "[data-composer-card] [contenteditable='true']",
  );
  if (!el) return;
  el.focus({ preventScroll: true });
  try {
    document.execCommand("insertText", false, text);
  } catch {
    // execCommand 不可用时兜底：直接派发 input 事件（Lexical 仍可捕获）
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertText", data: text }));
  }
}

function startDictation(): void {
  if (dictationState.active) return;
  const w = window as unknown as Record<string, unknown>;
  const SR = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
    | (new () => {
        lang: string;
        interimResults: boolean;
        continuous: boolean;
        onresult: ((e: Event) => void) | null;
        onend: (() => void) | null;
        onerror: (() => void) | null;
        start(): void;
        stop(): void;
      })
    | undefined;
  if (!SR) {
    window.dispatchEvent(new CustomEvent("mirach:toast", { detail: "当前环境不支持语音听写" }));
    return;
  }
  try {
    const rec = new SR();
    rec.lang = "zh-CN";
    rec.interimResults = true;
    rec.continuous = false;
    // 已插入的累计长度（interimResults 下 onresult 携带全量转写，
    // 只插入相对上次的增量，否则同一句会在编辑器里重复叠加）
    let insertedLen = 0;
    rec.onresult = (e: Event) => {
      const results = (e as unknown as { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }).results;
      let text = "";
      for (let i = 0; i < results.length; i++) text += results[i][0].transcript;
      const delta = text.slice(insertedLen);
      if (delta) {
        insertIntoComposer(delta);
        insertedLen = text.length;
      }
      if (results.length > 0 && results[results.length - 1].isFinal) {
        window.dispatchEvent(new CustomEvent("mirach:dictation-text", { detail: text }));
      }
    };
    rec.onend = () => {
      setDictation(false);
      recognition = null;
      insertedLen = 0;
    };
    rec.onerror = () => {
      setDictation(false);
      recognition = null;
      insertedLen = 0;
    };
    recognition = rec;
    rec.start();
    setDictation(true);
  } catch {
    setDictation(false);
  }
}

function stopDictation(): void {
  try { recognition?.stop(); } catch { /* ignore */ }
  setDictation(false);
}

function toggleDictation(): void {
  if (dictationState.active) stopDictation();
  else startDictation();
}

/** 订阅听写状态（useSyncExternalStore 风格的简单广播） */
function useDictationActive(): boolean {
  const [active, setActive] = useState(dictationState.active);
  useEffect(() => {
    const fn = (s: DictationState): void => setActive(s.active);
    dictationListeners.add(fn);
    return () => { dictationListeners.delete(fn); };
  }, []);
  return active;
}

// ── 注入控件本体 ─────────────────────────────────────────────────────────────

/** 朗读回复开关（$autoSpeak 真值驱动；mirach TTS 管道消费该 store） */
function SpeakToggle() {
  const speakActive = useStore($autoSpeak);
  return (
    <button
      type="button"
      className={`${EXTRA_BTN} ${speakActive ? "bg-[#F59E0B]/10 text-[#F59E0B]" : ""}`}
      title={speakActive ? "关闭朗读回复" : "开启朗读回复"}
      onClick={() => $autoSpeak.set(!speakActive)}
    >
      {speakActive ? (
        <Volume2 className="h-4 w-4" strokeWidth={2} />
      ) : (
        <VolumeX className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}

/** 内嵌终端开关（经全局事件切 MainPanel 的 terminalOpen，真实生效） */
function TerminalToggle() {
  return (
    <button
      type="button"
      className={EXTRA_BTN}
      title="展开终端"
      onClick={() => window.dispatchEvent(new CustomEvent("mirach:toggle-terminal"))}
    >
      <TerminalSquare className="h-4 w-4" strokeWidth={2} />
    </button>
  );
}

/** 唤醒词开关（plugin-wake-word 消费端：ear = 监听状态，tooltip 带原因/短语；
 *  右键 = 更换唤醒短语，prompt 输入后立即生效并持久化） */
function WakeToggle() {
  const wake = useStore($wakeWord);
  const title = wake.listening
    ? `关闭唤醒词（${wake.phrase}）`
    : wake.notice || `唤醒词（${wake.phrase}）· 右键更换短语`;
  return (
    <button
      type="button"
      className={`${EXTRA_BTN} ${wake.listening ? "bg-[#F59E0B]/10 text-[#F59E0B]" : ""}`}
      title={title}
      onClick={toggleWakeWord}
      onContextMenu={(e) => {
        e.preventDefault();
        const next = window.prompt("更换唤醒短语（如 hey hermes / 嘿 mirach）", wake.phrase);
        if (next === null) return;
        const clean = next.trim();
        if (!clean || clean === wake.phrase) return;
        void import("@/plugins/plugin-wake-word").then((m) => {
          m.setWakePhrase(clean);
          window.dispatchEvent(new CustomEvent("mirach:toast", { detail: `唤醒词已更换：${clean}` }));
        });
      }}
    >
      {wake.listening ? (
        <Ear className="h-4 w-4" strokeWidth={2} />
      ) : (
        <EarOff className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}

/** 语音听写开关（与"空输入点发送=语音"共用同一引擎单例） */
function DictationToggle() {
  const dictating = useDictationActive();
  return (
    <button
      type="button"
      className={`${EXTRA_BTN} ${dictating ? "bg-primary/10 text-primary" : ""}`}
      title={dictating ? "停止听写" : "语音听写"}
      onClick={toggleDictation}
    >
      {dictating ? (
        <Square className="h-3 w-3" fill="currentColor" strokeWidth={2} />
      ) : (
        <Mic className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}

/** left 槽：终端（权限预设右边） */
function LeftExtras() {
  return <TerminalToggle />;
}

/** right 槽：听写 → 朗读 → 唤醒（模型左边；用户定序从右往左 = 发送/唤醒/朗读/听写/模型/用量） */
function RightExtras() {
  return (
    <>
      <DictationToggle />
      <SpeakToggle />
      <WakeToggle />
    </>
  );
}

/**
 * 空输入点击发送 = 语音（mirach 原 Composer 语义；官方源码零改动）。
 *
 * 官方 InputBar 空态时主按钮是 disabled 的（点击被浏览器吞掉），且空态有
 * 稳定 DOM 标记：[data-composer-placeholder] 只在 draft 为空时渲染。本组件
 * 在 dsh-native-area 内做一层透明覆盖：
 *   - 空态时给主按钮打 data-mirach-voice="voice" 标记（CSS 换成话筒幽灵钮），
 *     并把一个透明可点击层对位到按钮上，点击派发 mirach:voice-request
 *     （registerComposerExtras 已监听并启停听写）；
 *   - 非空态（placeholder 卸载）立即摘标记、撤覆盖层，发送键恢复原样。
 * 定位以 .dsh-native-area 为包含块（relative），ResizeObserver 跟随卡片宽度
 * 变化重算，官方组件更新导致类名变化也不受影响（全部结构/属性选择器）。
 */
export function OfficialVoiceSend(): null {
  useEffect(() => {
    const area = document.querySelector(".dsh-native-area");
    if (area === null) return;

    let overlay: HTMLDivElement | null = null;
    let raf = 0;
    const marked = new Set<HTMLButtonElement>();

    const clearMarks = (): void => {
      for (const btn of marked) delete btn.dataset.mirachVoice;
      marked.clear();
    };

    const ensureOverlay = (): HTMLDivElement => {
      if (overlay !== null) return overlay;
      overlay = document.createElement("div");
      overlay.setAttribute("data-mirach-voice-overlay", "");
      overlay.title = "语音输入";
      overlay.style.position = "absolute";
      overlay.style.zIndex = "6";
      overlay.style.width = "34px";
      overlay.style.height = "34px";
      overlay.style.borderRadius = "999px";
      overlay.style.cursor = "pointer";
      overlay.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent("mirach:voice-request"));
      });
      area.appendChild(overlay);
      return overlay;
    };

    const sync = (): void => {
      raf = 0;
      const card = area.querySelector<HTMLElement>("[data-composer-card]");
      const placeholder = card?.querySelector("[data-composer-placeholder]") ?? null;
      const buttons = card
        ? Array.from(card.querySelectorAll<HTMLButtonElement>("button[class*='_primary']"))
        : [];
      const send = buttons.length > 0 ? buttons[buttons.length - 1] : null;
      const voiceIdle = placeholder !== null && send !== null && send.disabled && !send.closest("[data-mirach-voice-overlay]");

      if (voiceIdle && send !== null && area instanceof HTMLElement) {
        send.dataset.mirachVoice = "voice";
        marked.add(send);
        const btnRect = send.getBoundingClientRect();
        const areaRect = area.getBoundingClientRect();
        const ov = ensureOverlay();
        ov.style.left = `${btnRect.left - areaRect.left}px`;
        ov.style.top = `${btnRect.top - areaRect.top}px`;
        ov.style.display = "block";
      } else {
        clearMarks();
        if (overlay !== null) overlay.style.display = "none";
      }
    };

    const schedule = (): void => {
      if (raf) return;
      raf = window.requestAnimationFrame(sync);
    };

    // 空态标记出现/消失、按钮 disabled 切换都是 DOM 变更 → 子树监听足够；
    // 卡片宽度变化（窗口/列宽拖拽）用 ResizeObserver 兜住重定位。
    const mo = new MutationObserver(schedule);
    mo.observe(area, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "class"] });
    const ro = new ResizeObserver(schedule);
    for (const card of area.querySelectorAll("[data-composer-card]")) ro.observe(card);
    // 卡片可能后挂载（官方树就绪晚于本 effect）→ 挂载期兜底轮询一小段
    let tries = 0;
    const early = window.setInterval(() => {
      tries += 1;
      const card = area.querySelector("[data-composer-card]");
      if (card !== null) {
        ro.observe(card);
        schedule();
        window.clearInterval(early);
      } else if (tries > 40) {
        window.clearInterval(early);
      }
    }, 500);

    sync();
    return () => {
      window.clearInterval(early);
      mo.disconnect();
      ro.disconnect();
      if (raf) window.cancelAnimationFrame(raf);
      clearMarks();
      overlay?.remove();
      overlay = null;
    };
  }, []);
  return null;
}

/**
 * 工具行自适应折叠观察器（官方源码零改动；渲染 null，纯副作用）。
 *
 * 用户定序：收窄时永不折行，先模型按钮收成图标、再模式 chip 收成图标、
 * 省略兜底。断点必须随内容变化（模型名长短不同），固定宽度断点做不到——
 * 这里用"开始省略"作为信号：
 *   stage 0 → 1：模型文字出现截断（flexbox 先挤模型——唯一可缩长文本）；
 *   stage 1 → 2：模式 chip 文字出现截断（stage 0 时它故意不可缩）。
 * 放宽时按行内剩余空间逐级回退（8px 迟滞防抖动）；一次只走一级。
 * 结果写到 composer 卡片的 data-mirach-collapse（"model" / "model mode"），
 * CSS 据此折叠文字、给模型钮补 cpu 图标；折叠态 label 用 max-width:0 留场，
 * scrollWidth 可测自然宽供回退判断。
 */
export function ComposerRowAdaptive(): null {
  useEffect(() => {
    const area = document.querySelector(".dsh-native-area");
    if (area === null) return;

    let raf = 0;
    let stage = 0;
    let upStreak = 0;
    let downStreak = 0;
    let observedRow: Element | null = null;

    const tick = (): void => {
      raf = 0;
      const card = area.querySelector("[data-composer-card]") as HTMLElement | null;
      const tools = card?.querySelector("[class*='_tools']") ?? null;
      const row = tools?.parentElement ?? null;
      if (card === null || tools === null || row === null) return;
      if (observedRow !== row) {
        observedRow = row;
        ro.observe(row);
      }
      const trailing = row.querySelector("[class*='_trailing']");
      const modes = row.querySelector("[class*='_modes']");
      const accessLabel = modes?.querySelector("button[class*='_trigger'] [class*='_triggerLabel']") ?? null;
      if (trailing === null || modes === null || accessLabel === null) return;

      // 单级折叠：官方模型钮自带容器查询图标态（_triggerIcon，容器 ≤360px 时
      // 自动只显示图标并隐藏文字）——mirach 不再自造模型图标（会与官方图标
      // 重复成"两个图标"）。这里只处理自定义权限预设 "Mirach Auto" 没有官方
      // 字形的情况：空间不足时把模式文字收成图标（CSS 按 aria-label 补闪电）。
      //
      // 稳定余量：把当前折叠隐藏掉的文字宽度加回 trailing 实测宽，得到"若展开"
      // 的占用——折叠/展开本身不改变 free，消除来回抖动。
      const hiddenAccess = stage >= 1 ? accessLabel.scrollWidth : 0;
      const freeExpanded =
        row.clientWidth -
        (tools as HTMLElement).offsetWidth -
        ((trailing as HTMLElement).offsetWidth + hiddenAccess) -
        16;

      const HYST = 12;
      let next = stage;
      if (stage === 0) {
        if (freeExpanded < 0) {
          upStreak += 1;
          if (upStreak >= 2) { next = 1; upStreak = 0; }
        } else upStreak = 0;
      } else {
        if (freeExpanded > accessLabel.scrollWidth + HYST) {
          downStreak += 1;
          if (downStreak >= 2) { next = 0; downStreak = 0; }
        } else downStreak = 0;
      }

      if (next !== stage) {
        stage = next;
        if (stage === 0) delete card.dataset.mirachCollapse;
        else card.dataset.mirachCollapse = "mode";
      }
    };

    const schedule = (): void => {
      if (!raf) raf = window.requestAnimationFrame(tick);
    };
    const ro = new ResizeObserver(schedule);
    const mo = new MutationObserver(schedule);
    mo.observe(area, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    schedule();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      observedRow = null;
      const card = area.querySelector("[data-composer-card]");
      if (card instanceof HTMLElement) delete card.dataset.mirachCollapse;
    };
  }, []);
  return null;
}

/**
 * mirach-auto 图标注入（官方源码零改动；渲染 null）。
 *
 * 官方 permissionGlyphs 只给三个内置预设配了盾形图标，profile 补丁注入的
 * mirach-auto 没有字形：闭合触发钮由 CSS 按 aria-label 补闪电（index.css），
 * 下拉菜单行官方 Menu 没有 DOM 钩子（id 只是 React key），这里观察菜单
 * 弹出，给 label 为 "Mirach Auto" 的行首插一个同款闪电 span（内联样式，
 * 不依赖哈希类名；官方 itemIcon 是 14px 行内块，这里对齐）。
 */
const MIRACH_AUTO_LABEL = "Mirach Auto";

const boltIconStyle: Partial<CSSStyleDeclaration> = {
  width: "14px",
  height: "14px",
  flex: "none",
  marginRight: "6px",
  background: "currentColor",
  webkitMask:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' fill='black'/%3E%3C/svg%3E\") center / contain no-repeat",
  mask: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M13 2L3 14h9l-1 8 10-12h-9l1-8z' fill='black'/%3E%3C/svg%3E\") center / contain no-repeat",
};

export function MirachAutoGlyph(): null {
  useEffect(() => {
    const area = document.querySelector(".dsh-native-area");
    if (area === null) return;

    let raf = 0;
    const injected = new Set<HTMLElement>();

    const tick = (): void => {
      raf = 0;
      for (const btn of area.querySelectorAll<HTMLElement>("button[role='menuitem']")) {
        if ((btn.textContent ?? "").trim() !== MIRACH_AUTO_LABEL) continue;
        if (btn.querySelector("[data-mirach-glyph]") !== null) continue;
        const icon = document.createElement("span");
        icon.dataset.mirachGlyph = "";
        Object.assign(icon.style, boltIconStyle);
        btn.insertBefore(icon, btn.firstChild);
        injected.add(icon);
      }
    };
    const schedule = (): void => {
      if (!raf) raf = window.requestAnimationFrame(tick);
    };
    const mo = new MutationObserver(schedule);
    mo.observe(area, { childList: true, subtree: true });
    schedule();
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      mo.disconnect();
      for (const el of injected) el.remove();
      injected.clear();
    };
  }, []);
  return null;
}

/**
 * 注册 mirach 附加控件进官方输入条子槽（boot 后调用一次；幂等——
 * 重复注册被官方 register 拒绝并告警）。
 * left: 终端（权限预设右边，order 100 排官方后）
 * right: 听写/朗读/唤醒（模型右边、用量左边，负 order 排官方模型前；
 *        用量环再经 mirach CSS order 前移到模型左边——官方 DOM 固定模型→用量）
 *
 * 幂等保护：boot 失败重试会再次进入本函数，具名监听器 + 模块级标志保证
 * voice-request 只挂一次（重复挂载 = toggleDictation 双触发 = 开即关）。
 */
let voiceRequestHandler: (() => void) | null = null;

export function registerComposerExtras(ctx: Context): void {
  try {
    const slots = (ctx as unknown as {
      slots?: { inject?: (key: string, cb: () => unknown) => void };
    }).slots;
    if (typeof slots?.inject !== "function") {
      logWarn("composer extras: slots.inject unavailable");
      return;
    }
    slots.inject("conversation.input.left", () => {
      ctx.slots.register(
        { name: "conversation.input.left", id: "mirach-terminal", order: 100 },
        LeftExtras as never,
      );
    });
    slots.inject("conversation.input.right", () => {
      ctx.slots.register(
        { name: "conversation.input.right", id: "mirach-voice-extras", order: -50 },
        RightExtras as never,
      );
    });
    // 会话统计条不再由 mirach 注册：官方 ui-chat 的 StatsPills（同一
    // composer.dock 槽）现已生效——此前它缺席是因为 ui-chat 整插件 pending
    // （缺 sidebarRight），mirach 的 StatsLine 只是临时替代，两个一起出现会
    // 重复。统计口径以官方投影（sessionStats/tokenUsage）为准。
    // 空输入点击发送 = 语音（官方 InputBar 空态时覆盖层派发该事件；具名监听只挂一次）
    if (voiceRequestHandler === null) {
      voiceRequestHandler = () => { toggleDictation(); };
      window.addEventListener("mirach:voice-request", voiceRequestHandler);
    }
    logInfo("composer extras registered: left=terminal, right=dictation+wake+speak");
  } catch (err) {
    logWarn("composer extras registration failed: %s", err instanceof Error ? err.message : String(err));
  }
}
