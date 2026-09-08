// Embed provider model. Detection is pure, synchronous, and dependency-free so
// it is safe to run during render and trivial to unit-test. Rendering lives in
// the LinkEmbed renderer keyed off `renderer`.
// 整库移植自 hermes 桌面端 components/assistant-ui/embeds/providers/types.ts。

export type EmbedProvider =
  | 'bilibili'
  | 'douyin'
  | 'hongguo'
  | 'ncm'
  | 'amap'
  | 'youtube'
  | 'spotify'

/** Which renderer materialises the descriptor. */
export type EmbedRenderer = 'frame'

interface EmbedLayout {
  /** Frame aspect ratio (width / height). For video/maps. */
  aspectRatio?: number
  /** Fixed pixel height for non-ratio embeds (music players). */
  height?: number
  /** Max rendered width in px; falls back to the conversation column. */
  maxWidth?: number
}

interface BaseEmbed extends EmbedLayout {
  /** Stable id for React keys / dedupe. */
  id: string
  /** Human-facing provider name (e.g. "Bilibili"). */
  label: string
  provider: EmbedProvider
  renderer: EmbedRenderer
  /** Canonical URL opened in the system browser from the card. */
  sourceUrl: string
}

/** A provider whose embed is a single iframe URL (video, music, map, ...). */
export interface FrameEmbed extends BaseEmbed {
  /** URL loaded inside the iframe. */
  embedUrl: string
  renderer: 'frame'
}

export type EmbedDescriptor = FrameEmbed

/** A provider matcher. Receives a parsed http(s) URL; returns null if unmatched. */
export type EmbedMatcher = (url: URL) => EmbedDescriptor | null

/** Strip a leading `www.`/`m.`/`mobile.` so host checks read cleanly. */
export function bareHost(host: string): string {
  return host.replace(/^(?:www|m|mobile)\./i, '').toLowerCase()
}
