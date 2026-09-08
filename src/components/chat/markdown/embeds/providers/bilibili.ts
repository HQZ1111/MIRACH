// Bilibili video embed — hermes provider 规范（providers/youtube.ts 同构）。
// B 站官方外链播放器：player.bilibili.com/player.html?bvid=…（高清、无广告、
// 免登录）；b23.tv 短链在服务端 302 到真实 BV 页——客户端不做网络请求，
// b23.tv 链接保持普通超链接（与 hermes 对短链的处理一致）。
import { bareHost, type EmbedMatcher } from '../types'

const BV_RE = /^BV[0-9A-Za-z]{10}$/

export const bilibili: EmbedMatcher = url => {
  const host = bareHost(url.hostname)

  if (host !== 'bilibili.com' && host !== 'bilibili.tv') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  let bvid = ''

  if (segments[0] === 'video') {
    bvid = segments[1] || ''
  }

  if (!BV_RE.test(bvid)) {
    return null
  }

  const params = new URLSearchParams({
    autoplay: '0',
    bvid,
    // 高分片默认弹幕可关；danmaku=0 隐藏弹幕层（外链播放器语义）
    danmaku: '0',
    high_quality: '1',
  })
  const page = url.searchParams.get('p')

  if (page && /^\d+$/.test(page)) {
    params.set('page', page)
  }

  return {
    aspectRatio: 16 / 9,
    embedUrl: `https://player.bilibili.com/player.html?${params.toString()}`,
    id: `bilibili:${bvid}${page ? `:p${page}` : ''}`,
    label: 'Bilibili',
    maxWidth: 640,
    provider: 'bilibili',
    renderer: 'frame',
    sourceUrl: url.toString(),
  }
}
