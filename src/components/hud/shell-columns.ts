/**
 * HUD 只保留"对话 + 输入条"—— 把官方 AppFrame 的侧栏列 / 右栏列藏掉。
 *
 * 为什么需要：hermes 的 HUD 渲染 `<WiredPane part="chatRoutes">`（只挂 chat 路由），
 * 天生没有侧栏；mirach 的 HUD 挂的是官方**整棵 root 树**，而官方 AppFrame 是三列
 * grid（`sidebar | 主列 | 右栏`，列宽走 inline style），于是 mirach 的左栏外壳在
 * 620px 宽的小窗里占掉整整一列 —— 用户看到的就是"半截左侧栏"，跟 hermes 的
 * Spotlight 条完全不是一回事。
 *
 * 做法：给官方 frame 与两翼列打标记（`data-hud-frame` / `data-hud-hide-col`），
 * 由 hud-styles.css 用 `!important` 归零列宽并隐藏（官方列宽是 inline style，
 * 只有 `!important` 压得住）。侧栏/右栏按**官方 slot 属性**认（`data-slot="sidebar"` /
 * `"rightbar"`），绝不按"第几个孩子"认 —— 认错就是藏掉对话列。
 *
 * 官方树是异步挂载 + 可能重渲染，所以用 MutationObserver 兜住；对同一元素打标记
 * 是幂等的，observer 不会自激。
 */

const HIDE_ATTR = 'data-hud-hide-col'
const MAIN_ATTR = 'data-hud-main-col'

function tagFrame(root: HTMLElement): void {
  const frame = root.querySelector<HTMLElement>('div[style*="grid-template-columns"]')

  if (!frame) {
    return
  }

  frame.setAttribute('data-hud-frame', '')

  for (const cell of Array.from(frame.children)) {
    if (!(cell instanceof HTMLElement)) {
      continue
    }

    // 官方 slot 包装器可能就是列本身，也可能在列内 —— 两种都认
    const wing =
      cell.matches('[data-slot="sidebar"], [data-slot="rightbar"]') ||
      cell.querySelector('[data-slot="sidebar"], [data-slot="rightbar"]') !== null

    // 主列 = 装 conversation 的那一列（HUD 要保的就是它）
    const main =
      cell.matches('[data-slot="conversation"]') ||
      cell.querySelector('[data-slot="conversation"]') !== null

    if (wing) {
      cell.setAttribute(HIDE_ATTR, '')
      cell.removeAttribute(MAIN_ATTR)
    } else if (main) {
      cell.setAttribute(MAIN_ATTR, '')
      cell.removeAttribute(HIDE_ATTR)
    } else {
      cell.removeAttribute(HIDE_ATTR)
      cell.removeAttribute(MAIN_ATTR)
    }
  }
}

/** 在 HUD 里持续维护"藏掉官方两翼列"的标记（幂等、可重入）。 */
export function watchHudShellColumns(root: HTMLElement): () => void {
  tagFrame(root)

  const observer = new MutationObserver(() => tagFrame(root))
  observer.observe(root, { childList: true, subtree: true })

  return () => observer.disconnect()
}
