import { type RefObject, useEffect, useState } from 'react'

/** Breathing room the sheet keeps above the first row, so the fade has
 *  somewhere to land. Folded into the measured height rather than added in CSS,
 *  so an empty transcript measures a true zero instead of a 12px strip. */
const HUD_SHEET_OVERHANG_PX = 12

/**
 * Measures the HUD's transcript band and publishes it as `--hud-band-height` /
 * `--hud-bar-height` on the root, returning whether the band + bar fill the
 * window (which gates the frost — see `useHudGlass`).
 *
 * The viewport mounts async (lazy chat surface); poll briefly until it exists,
 * then let the ResizeObserver own it. Window resize is separate: the
 * transcript's rows may not change size, but the available scrollback must, so
 * observing the rows alone cannot update the band.
 */
export function useHudTranscriptBand(rootRef: RefObject<HTMLDivElement | null>): boolean {
  const [filled, setFilled] = useState(false)

  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    let viewport: HTMLElement | null = null
    const ro = new ResizeObserver(() => measure())

    const measure = () => {
      const el = viewport ?? root.querySelector<HTMLElement>('[data-hud-slot~="aui_thread-viewport"]')

      if (el !== viewport) {
        viewport = el

        if (el) {
          ro.observe(el)

          if (el.firstElementChild) {
            ro.observe(el.firstElementChild)
          }
        }
      }

      // How tall the band actually needs to be — the tight bbox of the message
      // rows only. Measuring to the viewport edge counted the full-window scroll
      // container (min-height: 100%) as transcript and painted a empty slab almost
      // the size of the HUD.
      const rows = el?.querySelectorAll<HTMLElement>('[data-hud-slot~="aui_thread-content"] > *:not([data-slot])')

      // Zero-height rows are not a transcript. A fresh thread still renders
      // scaffolding inside the content box (clearance, empty state), so
      // counting rows alone paid the overhang for nothing and left a sliver of
      // sheet hanging under the bar with no text in it.
      const text = !rows?.length
        ? 0
        : Math.max(0, rows[rows.length - 1].getBoundingClientRect().bottom - rows[0].getBoundingClientRect().top)

      const contentSpan = text < 1 ? 0 : text + HUD_SHEET_OVERHANG_PX

      // Once the HUD has a transcript, a resize must buy readable scrollback.
      // The old glance-band ceiling froze this at 152px and turned every extra
      // pixel of native window height into empty transparent chrome.
      //
      // mirach：输入条在**对话区顶部**（hermes HUD_THREAD_ALWAYS_BELOW=true），
      // band 从 bar 下沿铺到对话区底部 —— 所以高度是"对话区剩余"，
      // 偏移是"对话区顶 → bar 下沿"，两个都从实测矩形来（官方列在 bar 上下自带留白，
      // 按 barHeight 硬算会压住对话或留缝）。
      const chatArea = root.querySelector<HTMLElement>('.dsh-native-area')
      // 量 **composer-root**（bar 的真实盒子）：composer-dock 在官方结构里是
      // `display: contents` 的 slot（0x0），拿它当 bar 会让 band 高度算成整窗。
      const bar = root.querySelector<HTMLElement>('[data-hud-slot~="composer-root"]')
      const barRect = bar?.getBoundingClientRect()
      const areaRect = chatArea?.getBoundingClientRect()
      const barHeight = barRect?.height ?? 0
      const available =
        barRect && areaRect ? Math.max(0, areaRect.bottom - barRect.bottom) : Math.max(0, (areaRect?.height ?? window.innerHeight) - barHeight)
      const visible = contentSpan < 1 ? 0 : Math.round(available)

      root.style.setProperty('--hud-band-height', `${visible}px`)

      if (bar && barRect) {
        ro.observe(bar)
        root.style.setProperty('--hud-bar-height', `${Math.round(barHeight)}px`)
        if (areaRect) {
          root.style.setProperty(
            '--hud-bar-offset',
            `${Math.round(Math.max(0, barRect.bottom - areaRect.top))}px`,
          )
        }
      }

      setFilled(barHeight + visible >= (areaRect?.height ?? window.innerHeight) - 1)
    }

    measure()

    // Once the viewport has mounted, the ResizeObserver above owns every
    // future measurement — a probe that never stops re-runs this on every
    // tick forever, which is exactly the sustained idle CPU / re-render loop
    // the HUD must not have.
    const probe = window.setInterval(() => {
      if (viewport) {
        window.clearInterval(probe)

        return
      }

      measure()
    }, 500)

    window.addEventListener('resize', measure)

    return () => {
      window.clearInterval(probe)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [rootRef])

  return filled
}
