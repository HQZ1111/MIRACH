// 整库移植自 hermes 桌面端 components/assistant-ui/embeds/providers/index.ts。
// All provider hosts are disjoint, so order is irrelevant — first match wins.
// mirach 目录：youtube/spotify（hermes 原生）+ 国产五家（bilibili/ncm/amap/
// douyin/hongguo，按同规范新增）。
import { amap } from './amap'
import { bilibili } from './bilibili'
import { douyin } from './douyin'
import { hongguo } from './hongguo'
import { ncm } from './ncm'
import type { EmbedDescriptor, EmbedMatcher } from '../types'

export type { EmbedDescriptor, EmbedProvider, EmbedRenderer, FrameEmbed } from '../types'

const MATCHERS: EmbedMatcher[] = [bilibili, ncm, amap, douyin, hongguo]

function parseUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)

    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * Resolve a URL to a rich-embed descriptor, or null when no provider matches.
 * Pure and synchronous — safe to call during render.
 */
export function detectEmbed(rawUrl: string | null | undefined): EmbedDescriptor | null {
  if (!rawUrl) {
    return null
  }

  const url = parseUrl(rawUrl)

  if (!url) {
    return null
  }

  for (const match of MATCHERS) {
    const descriptor = match(url)

    if (descriptor) {
      return descriptor
    }
  }

  return null
}

export function isEmbeddableUrl(rawUrl: string | null | undefined): boolean {
  return detectEmbed(rawUrl) !== null
}
