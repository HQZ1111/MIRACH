/**
 * composer-extras — 把 mirach 输入框特有控件注入官方 InputBar 的子槽位
 *
 * 官方输入条（ui-conversation InputBar）声明了 conversation.input.left /
 * right 子槽（left = 工具组、right = 模型/发送组）。本模块把 mirach 有、
 * 官方没有的输入框控件以官方槽位条目形态注册进去。
 *
 * 注入布局（用户指定）：
 *   left 工具组:  +号(built-in) → 权限预设(official) → 终端(our)
 *   right 尾组:   听写(our) → 唤醒(our) → 朗读(our) → 模型(official) → 上下文(official) → 发送(built-in)
 *
 * 组件本体保持 mirach 实现（nanostores/lucide 在同一 React 树），只借官方
 * 槽位获得官方排布与主题令牌（容器由官方渲染，无需自挂 DSW alias）。
 */

import { useEffect, useRef, useState } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { useStore } from "@nanostores/react";
import { Ear, EarOff, Mic, Square, TerminalSquare, Volume2, VolumeX } from "lucide-react";
import { $autoSpeak } from "@/store/chat";
import { logInfo, logWarn } from "./kernel-log";

/** 官方工具行 ghost 按钮的 mirach 视觉（对齐 mirach Composer GHOST_ICON_BTN） */
const EXTRA_BTN =
  "flex h-8 w-8 items-center justify-center rounded-lg text-[#464646] transition-colors hover:bg-black/5";

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

/** 唤醒词开关（hey-hermes 引擎侧待接入；UI 开关先行，状态持久化 localStorage） */
function WakeToggle() {
  const [wakeActive, setWakeActive] = useState(() => {
    try { return localStorage.getItem("mirach.wakeWord") === "on"; } catch { return false; }
  });
  return (
    <button
      type="button"
      className={`${EXTRA_BTN} ${wakeActive ? "bg-[#F59E0B]/10 text-[#F59E0B]" : ""}`}
      title={wakeActive ? "关闭唤醒词" : "唤醒词（待接入 · hey hermes）"}
      onClick={() => {
        setWakeActive((v) => {
          const next = !v;
          try { localStorage.setItem("mirach.wakeWord", next ? "on" : "off"); } catch { /* ignore */ }
          return next;
        });
      }}
    >
      {wakeActive ? (
        <Ear className="h-4 w-4" strokeWidth={2} />
      ) : (
        <EarOff className="h-4 w-4" strokeWidth={2} />
      )}
    </button>
  );
}

/** 语音听写（SpeechRecognition API；与 mirach Composer handleDictate 同链路） */
function DictationToggle() {
  const [dictating, setDictating] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);

  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* ignore */ } }, []);

  const toggle = () => {
    if (dictating) {
      try { recRef.current?.stop(); } catch { /* ignore */ }
      setDictating(false);
      return;
    }
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
    if (!SR) { window.dispatchEvent(new CustomEvent("mirach:toast", { detail: "当前环境不支持语音听写" })); return; }
    try {
      const rec = new SR();
      rec.lang = "zh-CN";
      rec.interimResults = true;
      rec.continuous = false;
      rec.onresult = (e: Event) => {
        const results = (e as unknown as { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }).results;
        let text = "";
        for (let i = 0; i < results.length; i++) text += results[i][0].transcript;
        window.dispatchEvent(new CustomEvent("mirach:dictation-text", { detail: text }));
      };
      rec.onend = () => setDictating(false);
      rec.onerror = () => setDictating(false);
      recRef.current = rec;
      rec.start();
      setDictating(true);
    } catch { setDictating(false); }
  };

  return (
    <button
      type="button"
      className={`${EXTRA_BTN} ${dictating ? "bg-primary/10 text-primary" : ""}`}
      title={dictating ? "停止听写" : "语音听写"}
      onClick={toggle}
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

/** right 槽：听写 → 唤醒 → 朗读（模型左边） */
function RightExtras() {
  return (
    <>
      <DictationToggle />
      <WakeToggle />
      <SpeakToggle />
    </>
  );
}

/**
 * 注册 mirach 附加控件进官方输入条子槽（boot 后调用一次；幂等——
 * 重复注册被官方 register 拒绝并告警）。
 * left: 终端（权限预设右边，order 100 排官方后）
 * right: 听写/唤醒/朗读（模型左边，负 order 排官方前）
 */
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
    logInfo("composer extras registered: left=terminal, right=dictation+wake+speak");
  } catch (err) {
    logWarn("composer extras registration failed: %s", err instanceof Error ? err.message : String(err));
  }
}
