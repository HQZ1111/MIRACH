// 整库移植自 hermes 桌面端 lib/voice-playback.ts，按 mirach 的语音引擎适配：
// hermes 的合成阶梯是「client-direct TTS → 网关 PCM WebSocket → POST data-URL」，
// mirach 的引擎是 Web Speech synthesis（lib/tts.ts），故：
//  - openClientDirectSpeechSession 的「句子切割 + 顺序播放 + barge-in 序列号」
//    管线原样保留，合成一级换成 speechSynthesis（utterance 自然排队，首句
//    即开口，不等全文）；
//  - 两个网络 rung（openSpeechStream / playSpeechDataUrl）不适用，删除；
//  - 状态机（$voicePlayback）、序列号守卫、stopVoicePlayback、中断闩锁
//    （markVoicePlaybackInterrupted）逐行同源。
// 依赖同源文件：store/voice-playback.ts、lib/speech-text.ts（sanitize）、
// voice-client-direct 的 cutSentences（句子切割器，原样内嵌于本文件底部）。

import {
  $voicePlayback,
  setVoicePlaybackState,
  type VoicePlaybackSource,
  type VoicePlaybackState,
} from '@/store/voice-playback'

import { sanitizeTextForSpeech } from './speech-text'

function currentState(
  status: VoicePlaybackState['status'],
  options?: VoicePlaybackOptions,
  audioElement: HTMLAudioElement | null = null,
): VoicePlaybackState {
  return {
    audioElement,
    messageId: options?.messageId ?? null,
    sequence,
    source: options?.source ?? null,
    status,
  }
}

export interface VoicePlaybackOptions {
  messageId?: string | null
  source: VoicePlaybackSource
}

let sequence = 0
// speechSynthesis 是全局单队列：当前会话的 utterance 集合 + 停止回调
let currentStop: (() => void) | null = null

export function stopVoicePlayback() {
  sequence += 1
  currentStop?.()
  currentStop = null

  try {
    window.speechSynthesis?.cancel()
  } catch {
    // ignore
  }

  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle',
  })
}

export function isVoicePlaybackActive() {
  return $voicePlayback.get().status !== 'idle'
}

// ---------------------------------------------------------------------------
// 流式会话 — 句子切割 + speechSynthesis 顺序播放。文本随 LLM delta 追加，
// 每成一句立即入队开口（ChatGPT 式语音先于全文），finish 后等队列放空。
// barge-in：stopVoicePlayback() 的 sequence 递增 + cancel() 立即静默。
// ---------------------------------------------------------------------------

export interface SpeechStreamSession {
  /** Feed more reply text as it streams in. Safe after `finish` (no-op). */
  append: (text: string) => void
  /** No more text coming — resolves `done` once the audio drains. */
  finish: () => void
  /**
   * 'done' — audio fully played (or barged via stopVoicePlayback)
   * 'fallback' — no speech produced（mirach 引擎下仅在全空文本时出现）
   */
  done: Promise<'done' | 'fallback'>
}

function openSpeechSession(options: VoicePlaybackOptions): SpeechStreamSession {
  let buffer = ''
  let finished = false
  let settled = false
  let started = false
  let pending = 0

  let settle: (value: 'done' | 'fallback') => void = () => undefined

  const done = new Promise<'done' | 'fallback'>((resolve) => {
    settle = (value) => {
      if (settled) {
        return
      }

      settled = true
      currentStop = null
      resolve(value)
    }
  })

  currentStop = () => {
    // barge-in：cancel 全队列；已开口按 done 收尾
    try {
      window.speechSynthesis?.cancel()
    } catch {
      // ignore
    }
    settle(started ? 'done' : 'fallback')
  }

  const speakSentence = (sentence: string) => {
    try {
      if (!('speechSynthesis' in window)) {
        return
      }

      const synth = window.speechSynthesis
      const voices = synth.getVoices()
      const voice =
        voices.find((v) => v.lang.toLowerCase().startsWith('zh')) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('en')) ??
        null

      // 超长句分段（对齐 mirach tts.ts 的 3000 字符切分，Web Speech 对超长
      // utterance 可能长时间不发声）
      const CHUNK = 3000
      const chunks: string[] = []
      for (let i = 0; i < sentence.length; i += CHUNK) {
        chunks.push(sentence.slice(i, i + CHUNK))
      }
      if (chunks.length === 0) return

      pending += chunks.length

      if (!started) {
        started = true
        setVoicePlaybackState(currentState('speaking', options))
      }

      for (const chunk of chunks) {
        const u = new SpeechSynthesisUtterance(chunk)
        if (voice) u.voice = voice
        u.lang = voice?.lang ?? 'zh-CN'
        u.rate = 1
        u.onend = () => {
          pending -= 1
          if (finished && pending <= 0 && !settled) {
            settle('done')
          }
        }
        u.onerror = () => {
          pending -= 1
          if (finished && pending <= 0 && !settled) {
            settle(started ? 'done' : 'fallback')
          }
        }
        synth.speak(u)
      }
    } catch {
      // 语音不可用：保持静默，finish 时按 fallback 收尾
    }
  }

  const ingest = (flush: boolean) => {
    const cut = cutSentences(buffer, flush)
    buffer = cut.rest

    if (cut.sentences.length > 0) {
      // Sanitize per sentence — same granularity as the server pipeline
      // (markdown constructs can span delta boundaries, sentences can't).
      for (const sentence of cut.sentences) {
        const speakable = sanitizeTextForSpeech(sentence)

        if (speakable) {
          speakSentence(speakable)
        }
      }
    } else if (flush && finished && pending <= 0 && !settled) {
      settle(started ? 'done' : 'fallback')
    }
  }

  return {
    append: (text) => {
      if (text && !finished && !settled) {
        buffer += text
        ingest(false)
      }
    },
    finish: () => {
      if (!finished && !settled) {
        finished = true
        ingest(true)
        // 空文本 / 引擎不可用：立即收尾
        if (pending <= 0 && !settled) {
          settle(started ? 'done' : 'fallback')
        }
      }
    },
    done,
  }
}

/**
 * Live-speak an in-progress reply: open a session, then `append` deltas and
 * `finish` when generation completes.（hermes 同名 API；mirach 阶梯只有
 * 本地合成一级，恒可用——返回会话而非 null）
 */
export function startSpeechStream(options: VoicePlaybackOptions): SpeechStreamSession {
  stopVoicePlayback()
  setVoicePlaybackState(currentState('preparing', options))

  const session = openSpeechSession(options)

  void session.done.then((outcome) => {
    if (outcome === 'done') {
      setVoicePlaybackState(currentState('idle'))
    }
  })

  return session
}

/** One-shot playback of complete text（hermes playSpeechText 的 mirach 阶梯）。 */
export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback()

  const speakableText = sanitizeTextForSpeech(text)

  if (!speakableText) {
    return false
  }

  const ownSequence = sequence
  const isCurrent = () => ownSequence === sequence

  setVoicePlaybackState(currentState('preparing', options))

  const session = openSpeechSession(options)
  session.append(speakableText)
  session.finish()

  const outcome = await session.done

  if (!isCurrent()) {
    return false
  }

  if (outcome === 'done') {
    setVoicePlaybackState(currentState('idle'))
  }

  return outcome === 'done'
}

// ---------------------------------------------------------------------------
// Interruption latch — the next prompt.submit carries `interrupted: true` so
// the model knows its spoken reply was cut off (it can react: "rude!").
// Marked by the barge-in paths (typing over playback); TTL'd so a stale
// barge never annotates an unrelated message minutes later.
// ---------------------------------------------------------------------------

const INTERRUPT_TTL_MS = 120_000
let interruptedAt: null | number = null

export function markVoicePlaybackInterrupted() {
  interruptedAt = Date.now()
}

export function takeVoicePlaybackInterrupted(): boolean {
  const at = interruptedAt
  interruptedAt = null

  return at !== null && Date.now() - at < INTERRUPT_TTL_MS
}

// ---------------------------------------------------------------------------
// Sentence cutter for the streaming TTS session — mirrors the server-side
// SentenceChunker's contract: emit complete sentences as they form, hold
// the incomplete tail, flush everything on finish.
// （hermes lib/voice-client-direct.ts cutSentences 原样内嵌——纯函数，零依赖）
// ---------------------------------------------------------------------------

const SENTENCE_BOUNDARY_RE = /[.!?…。！？]+["'”’)\]]*\s+/g
const MIN_SENTENCE_CHARS = 24

export function cutSentences(buffer: string, flush: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = []
  let rest = buffer
  let start = 0

  SENTENCE_BOUNDARY_RE.lastIndex = 0

  let match = SENTENCE_BOUNDARY_RE.exec(buffer)

  while (match) {
    const end = match.index + match[0].length
    const candidate = buffer.slice(start, end).trim()

    // Too-short fragments ("e.g. ", "1. ") stay buffered so we don't fire a
    // provider call per abbreviation — unless a later boundary extends them.
    if (candidate.length >= MIN_SENTENCE_CHARS) {
      sentences.push(candidate)
      start = end
    }

    match = SENTENCE_BOUNDARY_RE.exec(buffer)
  }

  rest = buffer.slice(start)

  if (flush) {
    const tail = rest.trim()

    if (tail) {
      sentences.push(tail)
    }

    rest = ''
  }

  return { sentences, rest }
}
