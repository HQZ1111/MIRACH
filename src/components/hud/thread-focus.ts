import { type RefObject, useEffect } from 'react'

// mirach 适配：hermes 的 focusComposerInput（focus steal 语义）→ 直接 DOM
// focus；RICH_INPUT_SLOT → mirach composer 卡片的 contenteditable 特征选择器。
const COMPOSER_INPUT_SELECTOR = "[data-composer-card] [contenteditable='true']"

const THREAD_INTERACTIVE = 'a[href], button, input, textarea, select, [contenteditable], [role="button"], [role="link"]'

/**
 * In HUD mode the band is for reading over another app — clicking a line is not
 * leaving the composer. Without this, mousedown on the scrollback blurs the
 * input, the band fades, and the focus ring vanishes mid-read.
 */
export function useHudThreadFocus(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const root = rootRef.current

    if (!root) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return
      }

      const target = event.target

      if (!(target instanceof Element)) {
        return
      }

      if (!target.closest('[data-composer-card]')) {
        return
      }

      if (target.closest(THREAD_INTERACTIVE)) {
        return
      }

      event.preventDefault()

      root.querySelector<HTMLElement>(COMPOSER_INPUT_SELECTOR)?.focus({ preventScroll: true })
    }

    root.addEventListener('pointerdown', onPointerDown, true)

    return () => root.removeEventListener('pointerdown', onPointerDown, true)
  }, [rootRef])
}
