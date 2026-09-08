/**
 * HUD mode — the chrome-free floating chat.
 * 整库移植自 hermes 桌面端 store/hud.ts：模式旗标/生命周期管理原样。
 * 适配点：hermes 走 Electron 主进程桥（window.hermesDesktop.hud.*），mirach
 * 走 Tauri commands（hud_open/hud_close，src-tauri lib.rs 同名命令）。
 *
 * A transparent, frameless, always-on-top window showing nothing but the REAL
 * composer with the reply scrolling above it, so Mirach can be driven while
 * the user works in another app.
 *
 * It is NOT a puppet window. The HUD is a full app renderer — the same thing
 * `open_session_window()` spawns, just reshaped (?win=hud 分流)。That is the
 * whole design: the HUD renders the app's own chat surface in its hud variant.
 * This module owns only the mode flag and the window lifecycle.
 */

import { atom } from 'nanostores'
import { invoke } from '@tauri-apps/api/core'

/** Whether a HUD window is currently up. In the HUD's own renderer this is
 *  always true (it IS the HUD); in the main window it tracks the child so the
 *  toggle reads correctly.
 *
 *  Deliberately NOT persisted. The HUD is a live window main owns, so it can
 *  never outlive the app — a remembered `true` from the last run just makes the
 *  first toggle a no-op ("the button does nothing after a restart"). */
export const $hudActive = atom(isHudWindow())

/** True only in the HUD window itself — the renderer flag that swaps the app
 *  shell for the slim floating layout. Constant for the window's life, so it
 *  never invalidates a render path mid-session. */
export const $hudMode = atom(isHudWindow())

/** Which conversation the HUD is showing, as far as this window knows. */
export const $hudSession = atom<null | string>(null)

/** ?win=hud 分流标记（main.tsx 据此渲染 HudShell 而非完整应用） */
export function isHudWindow(): boolean {
  return new URLSearchParams(window.location.search).get('win') === 'hud'
}

/** True when the shell exposes HUD mode（Tauri 桌面环境恒可用）。 */
export const canUseHud = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export function openHud(): void {
  $hudActive.set(true)
  void invoke('hud_open').catch(() => $hudActive.set(false))
}

/** Leave HUD mode. Callable from either window — main closes the child, the
 *  HUD closes itself. */
export function closeHud(): void {
  $hudActive.set(false)
  $hudSession.set(null)
  void invoke('hud_close').catch(() => {})
}

export const toggleHud = () => ($hudActive.get() ? closeHud() : openHud())

/** 监听 HUD 窗口自身关闭（⌘W / 关闭按钮）→ 主窗口旗标归位。
 *  Tauri 无 Electron 的 changed 广播：监听本窗 unload 语义不可行，改为
 *  主窗口轮询窗口列表（轻量，1s），HUD 存在即 active。 */
export function watchHudState(): () => void {
  if (!canUseHud() || isHudWindow()) {
    return () => {}
  }

  let stopped = false
  const poll = async () => {
    while (!stopped) {
      try {
        const { Window } = await import('@tauri-apps/api/window')
        const all = await Window.getAll()
        $hudActive.set(all.some((w) => w.label === 'hud'))
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  void poll()

  return () => {
    stopped = true
  }
}
