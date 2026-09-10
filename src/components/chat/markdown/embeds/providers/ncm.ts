// 网易云音乐 embed — hermes provider 规范（providers/spotify.ts 同构：固定
// 高度的官方外链播放器）。music.163.com 外链播放器支持 song/playlist/album/
// radio，iframe 高度按类型分档（歌单/专辑高、单曲矮）。
import { bareHost, type EmbedMatcher } from '../types'

const HEIGHTS: Record<string, number> = {
  song: 86,
  playlist: 450,
  album: 450,
  radio: 450,
}

export const ncm: EmbedMatcher = url => {
  const host = bareHost(url.hostname)

  if (host !== 'music.163.com') {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  let type = ''
  let id = url.searchParams.get('id') || ''

  // /song?id=… /playlist?id=…（query 型）；/song/123456（路径型）
  if (['song', 'playlist', 'album', 'radio'].includes(segments[0] || '')) {
    type = segments[0] ?? ""
    id = id || segments[1] || ''
  }

  if (!type || !/^\d+$/.test(id)) {
    return null
  }

  // 官方外链播放器（outchain）：auto=1 按 id 类型自动适配
  const params = new URLSearchParams({ auto: '1', height: '90', size: 'big', type, width: '330' })
  void params // outchain 参数固定，直接拼串（保持官方文档形态）

  return {
    embedUrl: `https://music.163.com/outchain/player?type=${type}&id=${id}&auto=0&height=90&size=big`,
    height: HEIGHTS[type] ?? 86,
    id: `ncm:${type}:${id}`,
    label: '网易云音乐',
    maxWidth: 480,
    provider: 'ncm',
    renderer: 'frame',
    sourceUrl: url.toString(),
  }
}
