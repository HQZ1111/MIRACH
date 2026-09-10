/**
 * HUD 停靠边 → `data-hud-edge`。
 *
 * hermes 由主进程在移动/缩放后广播（main 的 window watch）；mirach 的 HUD 渲染进程
 * 自己算：窗口中心落在显示器**工作区上半** → `'top'`（composer 贴窗口上沿、transcript
 * 带向下挂），下半 → `'bottom'`（默认朝向：composer 贴下沿、带向上挂）。
 * hud_open 把 HUD 放在底部居中（hermes hud-geometry 的默认几何），所以默认就是
 * `'bottom'`；把窗口拖到屏幕上半区，整条 HUD 会像 hermes 一样镜像翻转。
 *
 * 不使用 Electron 的 screen API：Tauri 走 `@tauri-apps/api/window` 的
 * `outerPosition` / `currentMonitor` + `onMoved`。
 */
import { useEffect, useState } from 'react'

export type HudEdge = 'top' | 'bottom'

export function useHudEdge(): HudEdge {
  const [edge, setEdge] = useState<HudEdge>('bottom')

  useEffect(() => {
    let alive = true
    let unlisten: (() => void) | null = null

    const compute = async () => {
      try {
        const { getCurrentWindow, currentMonitor } = await import('@tauri-apps/api/window')
        const win = getCurrentWindow()
        const [pos, size, mon] = await Promise.all([win.outerPosition(), win.outerSize(), currentMonitor()])

        if (!alive || !mon) {
          return
        }

        const centerY = pos.y + size.height / 2
        const monitorCenterY = mon.position.y + mon.size.height / 2

        setEdge(centerY < monitorCenterY ? 'top' : 'bottom')
      } catch {
        /* 浏览器预览 / 无 Tauri：保持默认边 */
      }
    }

    void compute()

    void (async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        unlisten = await getCurrentWindow().onMoved(() => void compute())
      } catch {
        /* 没有事件面时靠 resize/初次计算 */
      }
    })()

    const onResize = () => void compute()
    window.addEventListener('resize', onResize)

    return () => {
      alive = false
      unlisten?.()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return edge
}
