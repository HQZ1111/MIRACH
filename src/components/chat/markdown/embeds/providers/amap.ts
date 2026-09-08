// 高德地图 embed — hermes providers/maps.ts 同构（keyless 公开嵌入面）。
// 高德的公开 embed 形态：uri/geo API 不足以内嵌，用 `amap.com/reveal`
// （分享页 iframe）或在 urlname 上带位置名。支持三类链接：
//   1) ditu.amap.com/reveal?…（官方分享页，直接 iframe）
//   2) ditu.amap.com/search?query=…/view?lat,lng（构造 reveal 嵌入）
//   3) uri.amap.com/marker?position=…（分享标记 → reveal）
import { bareHost, type EmbedMatcher, type FrameEmbed } from '../types'

const AMAP_REVEAL = 'https://ditu.amap.com/reveal'

function amapEmbed(url: URL): FrameEmbed | null {
  const host = bareHost(url.hostname)

  if (host !== 'amap.com' && host !== 'ditu.amap.com' && host !== 'uri.amap.com') {
    return null
  }

  // 官方分享页：直接 iframe 其本身
  if (host === 'ditu.amap.com' && url.pathname === '/reveal') {
    return {
      aspectRatio: 16 / 10,
      embedUrl: url.toString(),
      id: `amap:reveal:${url.search}`,
      label: '高德地图',
      maxWidth: 640,
      provider: 'amap',
      renderer: 'frame',
      sourceUrl: url.toString(),
    }
  }

  // 标记分享：uri.amap.com/marker?position=lng,lat&name=…
  const position = url.searchParams.get('position')

  if (host === 'uri.amap.com' && position && /^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(position)) {
    const params = new URLSearchParams({ position })
    const name = url.searchParams.get('name')

    if (name) {
      params.set('name', name)
    }

    return {
      aspectRatio: 16 / 10,
      embedUrl: `${AMAP_REVEAL}?${params.toString()}`,
      id: `amap:marker:${position}`,
      label: '高德地图',
      maxWidth: 640,
      provider: 'amap',
      renderer: 'frame',
      sourceUrl: url.toString(),
    }
  }

  // 搜索/查看页：把 query 或坐标构造成 reveal 嵌入
  const query = url.searchParams.get('query') || url.searchParams.get('keywords') || ''
  const isView = host === 'ditu.amap.com' && url.pathname === '/view'
  let q = ''

  if (query) {
    q = query
  } else if (isView) {
    q = decodeURIComponent(url.search)
  }

  if (!q) {
    return null
  }

  return {
    aspectRatio: 16 / 10,
    embedUrl: `${AMAP_REVEAL}?q=${encodeURIComponent(q)}`,
    id: `amap:q:${q}`,
    label: '高德地图',
    maxWidth: 640,
    provider: 'amap',
    renderer: 'frame',
    sourceUrl: url.toString(),
  }
}

export const amap: EmbedMatcher = url => amapEmbed(url)
