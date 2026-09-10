/**
 * HudShell — HUD 模式外壳（chrome-less 悬浮会话）
 *
 * 整库移植自 hermes 桌面端 app/hud/hud-shell.tsx：Spotlight 形态（居中
 * composer 条 + 上方渐隐 transcript 带）、边缘停靠翻转、点击穿透、resize
 * 边框、窗口拖拽、玻璃层——机制逐行同源。
 *
 * mirach 适配（相对 hermes 的差异面）：
 *  - 聊天表面：hermes 渲染 WiredPane（官方 ChatView + hermes composer）；
 *    mirach 渲染同一套官方原生树（NativeChatArea，内核 boot 后即真实
 *    composer/transcript），所以 HUD 里的 composer 就是应用的 composer。
 *  - 窗口桥：Electron hud IPC → Tauri commands（见 store/hud.ts、各 hook）。
 *  - 游戏覆盖层（game-overlay 检测主窗口前台应用）不移植——依赖 Electron
 *    桌面枚举，Windows 上 mirach 无此数据面。
 *  - glass 原生磨砂 → CSS 半透明（glass.ts 内已适配）。
 */
import { useStore } from '@nanostores/react'
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react'

import { $liveMessages, $aiStreaming } from '@/store/chat'
import { $activeSessionId } from '@/store/session'
import { $hudSession, closeHud } from '@/store/hud'

import { NativeChatArea } from '@/components/chat/NativeChatArea'

import { useHudClickThrough } from './click-through'
import { useHudComposerDrag } from './composer-drag'
import { useHudGlass } from './glass'
import { useHudResizeHandle } from './resize-handle'
import { useHudThreadFocus } from './thread-focus'
import { useHudTranscriptBand } from './transcript-band'

/** How long the transcript lingers at its glanceable opacity — after a turn
 *  lands, or after you let go of the composer — before it goes. This is the ONLY
 *  hold: the CSS carries no transition-delay, because two stacked holds read as
 *  a third fade state that nobody asked for. Focus keeps it open past this. */
const HUD_RECENT_HOLD_MS = 1100

/** Band visibility timings, published to CSS as custom properties so this
 *  module and the stylesheet cannot drift apart. Reveal is quick — it is an
 *  answer to the user; the fade lingers, then goes slowly. */
const HUD_REVEAL_MS = 110
const HUD_FADE_MS = 180

/** The step DOWN to the glanceable opacity when you let go. Deliberately slower
 *  than the fade that follows it — easing off is a softer gesture than leaving,
 *  and matching them made the two read as one long dissolve. */
const HUD_DIM_MS = Math.round(HUD_FADE_MS * 1.5)

/** The sheet rolling shut. Shorter than the fade so the panel is already gone
 *  while the last of the text is still going — it reads as the transcript being
 *  drawn down into the bar rather than the two dissolving in lockstep. */
const HUD_COLLAPSE_MS = Math.round(HUD_FADE_MS * 0.66)

/** Composer on top, transcript always hanging below it — Spotlight's shape,
 *  rather than flipping to follow the screen edge the HUD is parked against.
 *  （hermes 恒 top；edge 感知翻转的 CSS 两套朝向仍随 hud-styles.css 转移） */
const HUD_THREAD_ALWAYS_BELOW = true
void HUD_THREAD_ALWAYS_BELOW

const composerHasFocus = () =>
  document.activeElement?.closest('[data-composer-card] [contenteditable]') != null

/**
 * True for a hold window after any conversation activity (a message landing,
 * a stream flushing, a turn starting or ending). The CSS uses it — alongside
 * :focus-within — to decide whether the thread is visible; idle HUD mode is
 * just the Spotlight bar.
 */
function useRecentActivity(): [boolean, () => void] {
  const [recent, setRecent] = useState(false)
  const timerRef = useRef<number | null>(null)

  const bumpRef = useRef(() => {})

  useEffect(() => {
    let signature = ''

    // `letGo` is the deliberate gesture — clicking away from the composer —
    // and always buys the full window. Ambient activity does not, unless the
    // composer has focus: whatever is left of the current hold is what a HUD
    // nobody is looking at gets.
    const bump = (letGo = false) => {
      if (timerRef.current) {
        if (!letGo && !composerHasFocus()) {
          return
        }

        clearTimeout(timerRef.current)
      }

      setRecent(true)
      timerRef.current = window.setTimeout(() => setRecent(false), HUD_RECENT_HOLD_MS)
    }

    // Gated on the transcript actually CHANGING, not on the atom being written.
    const onMessages = () => {
      const messages = $liveMessages.get()
      const last = messages[messages.length - 1]
      const next = `${messages.length}:${last?.id ?? ''}:${(last?.text ?? '').length}`

      if (next === signature) {
        return
      }

      signature = next
      bump()
    }

    bumpRef.current = () => bump(true)

    // subscribe() fires immediately, so a HUD opened onto an existing
    // conversation starts with the thread showing, then fades.
    const offMessages = $liveMessages.subscribe(onMessages)
    const offBusy = $aiStreaming.subscribe(busy => busy && bump())

    return () => {
      offMessages()
      offBusy()

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  // Stable, so callers can hang listeners off it.
  const holdBand = useCallback(() => bumpRef.current(), [])

  return [recent, holdBand]
}
/**
 * True while the HUD must stay up regardless of the hold timer.
 *
 * - The session being BUSY at all — thinking, calling a tool, streaming — plus
 *   a grace window after the turn ends, so the answer you were waiting for is
 *   still there when it arrives.
 * - （hermes 的 awaiting-input prompt 与 game overlay 在 mirach 无对应面，
 *   busy/grace 两项是核心）
 */
function useHudHeld(): boolean {
  const busy = useStore($aiStreaming)

  const [grace, setGrace] = useState(false)

  useEffect(() => {
    if (busy) {
      setGrace(true)

      return
    }

    // Falling edge: keep it up a moment longer, then let the fade have it.
    const timer = setTimeout(() => setGrace(false), HUD_RECENT_HOLD_MS)

    return () => clearTimeout(timer)
  }, [busy])

  return busy || grace
}

/**
 * HUD mode's shell — the chrome-free floating chat.
 *
 * Deliberately almost nothing: it mounts the SAME wired chat surface the main
 * window does, so the composer here IS the app's composer and the transcript
 * is the app's transcript. Only the frame changes — no titlebar, no sidebars.
 *
 * The shape is macOS Spotlight: at rest, the centered composer bar is the
 * whole interface. The thread renders as bare text above it and is
 * visibility-gated like a game chat frame — shown while a turn is recent or
 * the composer has focus, faded out otherwise.
 */
export function HudShell() {
  const [recent, holdBand] = useRecentActivity()
  const held = useHudHeld()

  // Clicking away to another APP is the most common way the HUD is let go of,
  // and it fires no focusout: the composer stays document.activeElement while
  // the window is inactive. The band lost its focus state with no hold running
  // and snapped shut instead of stepping down to the glanceable stage.
  useEffect(() => {
    window.addEventListener('blur', holdBand)

    return () => window.removeEventListener('blur', holdBand)
  }, [holdBand])

  // Main holds the session id on this window's behalf（mirach：HUD 与主窗共享
  // store 单例，直接上报活跃会话即可，handoff 语义同 hermes）。
  const activeSession = useStore($activeSessionId)
  useEffect(() => {
    $hudSession.set(activeSession ?? null)
  }, [activeSession])

  // （hermes 的 edge 感知翻转：HUD_THREAD_ALWAYS_BELOW=true 恒 'top'，保留常量）

  const rootRef = useRef<HTMLDivElement | null>(null)

  // Whether bar + band actually cover the window（mirach 无原生 frost，恒 false
  // 语义即可——glass 已空实现）。
  useHudTranscriptBand(rootRef)

  useHudGlass(rootRef, false)
  useHudClickThrough(rootRef)
  useHudThreadFocus(rootRef)

  // Edge/corner resize frame. The window is created non-resizable so dragging can
  // never be misread as a resize gesture; the handle is the one sanctioned way
  // to change size, driving programmatic setBounds（Tauri hud_set_bounds）。
  const { resizing: hudResizing, onPointerDown: onHudResizePointerDown } = useHudResizeHandle()

  // 风格面：composer 条长按拖拽移动窗口（hermes composer-drag 同款长按语义）
  const { grabbing: hudGrabbing, onPointerDown: onHudComposerPointerDown } = useHudComposerDrag(true)

  // Force the HOST layers transparent. The anti-white-flash inline style on
  // <html> beats any stylesheet rule, so without this the window is a solid
  // slab. A style tag with `!important` is what quick entry already does.
  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = 'html,body,#root{background:transparent !important;}'
    document.head.appendChild(style)

    return () => style.remove()
  }, [])

  return (
    <div
      className="relative flex h-screen w-screen flex-col overflow-hidden"
      data-hud-edge="top"
      data-hud-held={held ? '' : undefined}
      data-hud-input="click-through"
      data-hud-recent={recent || held ? '' : undefined}
      data-hud-shell
      data-hud-grabbing={hudGrabbing ? '' : undefined}
      // Letting go of the composer re-arms the hold, so the transcript steps
      // down to its glanceable opacity and lingers there instead of jumping
      // straight from full to gone.
      onBlur={holdBand}
      ref={rootRef}
      style={
        {
          '--hud-fade': `${HUD_FADE_MS}ms`,
          '--hud-collapse': `${HUD_COLLAPSE_MS}ms`,
          '--hud-dim': `${HUD_DIM_MS}ms`,
          '--hud-reveal': `${HUD_REVEAL_MS}ms`
        } as CSSProperties
      }
    >
      {/* The band's sheet, on a layer of its own so it can carry the fade
          without the chat surface having to know about it. FIRST child so
          it paints behind the transcript. */}
      <div aria-hidden data-hud-glass />

      {/* 会话头部（极简）：会话名 + 退出 HUD。hermes 的退出 chip 同位。 */}
      <div data-hud-topbar>
        <span className="truncate text-[11px] font-medium text-white/85">{activeSession}</span>
        <button
          type="button"
          className="rounded-md px-2 py-0.5 text-[11px] text-white/85 transition-colors hover:bg-white/10"
          onClick={() => closeHud()}
        >
          退出悬浮
        </button>
      </div>

      {/* 官方原生聊天表面（与主对话区同一棵树）。HUD 是独立 WebView：
          内核镜像由 main.tsx 在 HUD 窗口里同样 boot（见那里的注释）。
          只挂一份 —— 之前这里有一个 display:none 的重复实例，两个实例会同时对
          同一个内核 context 调 nativeOpenSession/nativeRootTree，互相抢会话。 */}
      <div data-hud-chat-surface className="contents">
        <NativeChatArea sessionId={activeSession || 'default'} />
      </div>

      {/* CanvasTTY-style resize frame. Windows/macOS get every edge and corner;
          the handles are invisible chrome with native cursors.
          `data-hud-grabbing` keeps click-through from handing the pointer away
          while the window changes under it. */}
      {(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'] as const).map(direction => (
        <div
          aria-hidden
          data-hud-grabbing={hudResizing ? '' : undefined}
          data-hud-resize={direction}
          key={direction}
          onPointerDown={event => onHudResizePointerDown(event, direction)}
        />
      ))}

      {/* composer 拖拽握把层由 CSS data-hud-shell [data-composer-card] 面
          供能：长按 composer 即触发 hudBeginMove（见 composer-drag）。 */}
      <div
        data-hud-composer-grab
        onPointerDown={onHudComposerPointerDown}
        className="absolute inset-x-0 bottom-0 h-10"
      />
    </div>
  )
}
