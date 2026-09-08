// 全局快捷键分发器 — 整库移植自 hermes 桌面端 app/hooks/use-keybinds.ts 的
// 分发骨架（capture 模式 / IME 守卫 / 输入框放行矩阵 / keydown capture 监听），
// 动作处理器换成 mirach 对应面（hermes 的 profile/pane 树/终端/会话切换器/
// find-in-page 依赖在 mirach 无对应物，相关行删除；type-to-focus 属 hermes
// composer 的键盘优先体系，mirach 暂不移植）。
import { useEffect, useRef } from 'react'

import {
  actionAllowedInInput,
  comboFromEvent,
  isEditableTarget,
} from '@/lib/keybinds/combo'
import { contributedKeybindHandler } from '@/lib/keybinds/actions'
import { $capture, $comboIndex, endCapture, setBinding } from '@/store/keybinds'
import { toggleWakeWord } from '@/plugins/plugin-wake-word'
import { isHapticsMuted, setHapticsMuted } from '@/lib/haptics'

export interface KeybindRuntimeDeps {
  /** Toggle the command palette (⌘K). */
  toggleCommandPalette: () => void
  /** Drop to a fresh new-session draft (⌘N). */
  startFreshSession: () => void
  /** Cycle the recent content sessions (⌃Tab / ⌃⇧Tab). */
  cycleSession: (direction: 1 | -1) => void
  /** Jump to the Nth recent session（^1…^9，hermes session.slot 同位） */
  jumpSessionSlot: (slot: number) => void
  /** Open the session jump switcher (⌘J). */
  openSessionSwitcher: () => void
  /** Toggle the official sidebar column (⌘B). */
  toggleSidebar: () => void
  /** Toggle the right sidebar (⌘⇧B / ⌘I). */
  toggleRightSidebar: () => void
  /** Open settings (⌘,). */
  openSettings: () => void
  /** Open an overlay page（产物/看板/定时任务） */
  openOverlay: (view: 'artifacts' | 'kanban' | 'cron') => void
  /** Toggle dark/light (⇧X). */
  toggleTheme: () => void
  /** Focus the composer input (⌘L). */
  focusComposer: () => void
}

type HandlerMap = Record<string, () => void>

// Mount once near the top of the app. Owns the single global keydown listener
// for every rebindable hotkey: it runs the matched action, or — while capture
// mode is active (edit overlay / panel rebind) — records the pressed combo.
export function useKeybinds(deps: KeybindRuntimeDeps): void {
  // Keep the latest closures without re-subscribing the listener.
  const handlersRef = useRef<HandlerMap>({})

  handlersRef.current = {
    'composer.focus': deps.focusComposer,
    // 语音输入开关（听写/唤醒指令共用一条链，经 mirach:voice-request）
    'composer.voice': () => window.dispatchEvent(new CustomEvent('mirach:voice-request')),

    'session.new': deps.startFreshSession,
    'session.next': () => deps.cycleSession(1),
    'session.prev': () => deps.cycleSession(-1),
    'session.jump': deps.openSessionSwitcher,
    'session.focusSearch': () => window.dispatchEvent(new CustomEvent('mirach:focus-sidebar-search')),

    'nav.commandPalette': deps.toggleCommandPalette,
    'nav.settings': deps.openSettings,
    'nav.artifacts': () => deps.openOverlay('artifacts'),
    'nav.kanban': () => deps.openOverlay('kanban'),
    'nav.cron': () => deps.openOverlay('cron'),

    'view.toggleSidebar': deps.toggleSidebar,
    'view.toggleRightSidebar': deps.toggleRightSidebar,
    'appearance.toggleMode': deps.toggleTheme,
    'view.wakeToggle': toggleWakeWord,
    'view.soundMute': () => {
      const next = !isHapticsMuted()
      setHapticsMuted(next)
    },
    'view.toggleHud': () => {
      void import('@/store/hud').then((m) => m.toggleHud())
    },
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // An active IME composition owns the keyboard. Windows Chinese IMEs
      // (Microsoft Pinyin, Sogou) use Ctrl+, as their punctuation-mode toggle,
      // so without this guard that keystroke ALSO matched `nav.settings` and
      // navigated away mid-word — unmounting the composer and destroying the
      // unsent draft (#41079).
      if (event.isComposing) {
        return
      }

      // Capture mode: the next real key becomes the binding. Swallow everything
      // so e.g. ⌘K rebinds instead of opening the palette.
      const capturing = $capture.get()

      if (capturing) {
        event.preventDefault()
        event.stopPropagation()

        if (event.key === 'Escape') {
          endCapture()

          return
        }

        const combo = comboFromEvent(event)

        if (!combo) {
          return
        }

        setBinding(capturing, [combo])
        endCapture()

        return
      }

      const combo = comboFromEvent(event)

      if (!combo) {
        return
      }

      const actionId = $comboIndex.get().get(combo)

      if (!actionId) {
        return
      }

      if (isEditableTarget(event.target) && !actionAllowedInInput(actionId, combo)) {
        return
      }

      // Built-in handlers first (they carry React context); contributed
      // actions bring their own `run` through the registry.
      const handler = handlersRef.current[actionId] ?? contributedKeybindHandler(actionId)

      if (!handler) {
        return
      }

      event.preventDefault()
      handler()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })

    return () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [])
}
