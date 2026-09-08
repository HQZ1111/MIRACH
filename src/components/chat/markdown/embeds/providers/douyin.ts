// 抖音 embed — hermes providers/tiktok.ts 同构（官方 player iframe，9:16 竖屏）。
// 抖音官方外链播放器：www.douyin.com/player/v1/<videoId>?…
import { bareHost, type EmbedMatcher } from '../types'

export const douyin: EmbedMatcher = url => {
  const host = bareHost(url.hostname)

  if (host !== 'douyin.com' && host !== 'iesdouyin.com') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const videoIndex = segments.indexOf('video')
  const id = videoIndex >= 0 ? segments[videoIndex + 1] : ''

  if (!/^\d+$/.test(id || '')) {
    return null
  }

  // 官方 player（autoplay 关、弹幕/水印跟随官方默认）；9:16 竖屏与 TikTok 同款
  return {
    aspectRatio: 9 / 16,
    embedUrl: `https://www.douyin.com/player/v1/${id}?autoplay=0&disableScreenshot=0`,
    id: `douyin:${id}`,
    label: '抖音',
    maxWidth: 365,
    provider: 'douyin',
    renderer: 'frame',
    sourceUrl: url.toString(),
  }
}
