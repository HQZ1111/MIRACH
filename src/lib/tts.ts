/**
 * tts — 朗读回复（Web Speech synthesis，无依赖）
 */

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  return (
    voices.find((v) => v.lang.toLowerCase().startsWith("zh")) ??
    voices.find((v) => v.lang.toLowerCase().startsWith("en")) ??
    null
  );
}

export function speak(text: string): void {
  try {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    // 超长文本分段朗读（每段约 3000 字符）：Web Speech 对超长 utterance 可能长时间
    // 不发声，拆成多个 utterance 排队自然衔接，保证长回复完整朗读
    const CHUNK = 3000;
    const chunks: string[] = [];
    for (let i = 0; i < text.length; i += CHUNK) {
      chunks.push(text.slice(i, i + CHUNK));
    }
    if (chunks.length === 0) return;
    for (const chunk of chunks) {
      const u = new SpeechSynthesisUtterance(chunk);
      if (!voice) voice = pickVoice();
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? "zh-CN";
      u.rate = 1;
      window.speechSynthesis.speak(u);
    }
  } catch {
    /* 语音不可用时忽略 */
  }
}

export function stopSpeaking(): void {
  try {
    window.speechSynthesis?.cancel();
  } catch {
    /* ignore */
  }
}

export function isSpeaking(): boolean {
  try {
    return window.speechSynthesis?.speaking ?? false;
  } catch {
    return false;
  }
}
