// 红果短剧 embed — hermes provider 规范（providers/tiktok.ts 同构）。
// 红果短剧（番茄旗下）网页端 share 页是 SPA、无公开 iframe 播放器；采用
// 与 hermes 对"无 iframe 面"平台的降级一致：识别链接并渲染为站内卡片
// （标题 + 封面语义 + 跳转按钮）不成立时回退普通链接。当前按 episode id
// 识别 `/hongguo/detail?episodeId=…` 分享链，渲染 frame 到其 share 页
// （X-Frame-Options 允许同系嵌套时生效，否则用户点击"打开"走系统浏览器）。
import { bareHost, type EmbedMatcher } from '../types'

export const hongguo: EmbedMatcher = url => {
  const host = bareHost(url.hostname)

  if (host !== 'hongguo.baidu.com' && host !== 'hongguo.com') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  const detailIndex = segments.indexOf('detail')
  const id = detailIndex >= 0 ? segments[detailIndex + 1] || url.searchParams.get('episodeId') || '' : ''

  if (!/^\d+$/.test(id || '')) {
    return null
  }

  // 红果无公开 player；share 页内嵌（受平台 XFO 策略约束，失败时点卡片打开）
  return {
    aspectRatio: 9 / 16,
    embedUrl: url.toString(),
    id: `hongguo:${id}`,
    label: '红果短剧',
    maxWidth: 365,
    provider: 'hongguo',
    renderer: 'frame',
    sourceUrl: url.toString(),
  }
}
