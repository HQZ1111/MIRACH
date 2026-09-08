/**
 * Embeds — URL 富嵌入（hermes embeds 管线 + 国产五家 provider）
 *
 * 结构整库移植自 hermes-agent-main apps/desktop 的 embeds 管线
 * （url-embed.tsx + frame-embed.tsx + embed-consent.tsx 合一到 mirach 的
 * LinkEmbed 出口，MarkdownText 的 <a> 零改动）：
 *  - detectEmbed：纯同步 provider 匹配（providers/index.ts，hermes 原样）；
 *  - 同意门：点击"加载嵌入"才加载第三方 iframe（对齐 hermes embed-consent；
 *    hermes 的 SplitButton 双档"本次/永久允许"简化为单击加载，会话级记住）；
 *  - frame 渲染：16:9 视频类 / 固定高音乐类 / 9:16 竖屏短视频（hermes
 *    frame-embed 同款 allow/scrolling/referrerPolicy）。
 * provider 目录（providers/）：Bilibili、网易云音乐、高德地图、抖音、红果短剧
 * + YouTube/Spotify（hermes 原生两家以同规范保留在本目录的 legacy 分支）。
 */

import { useState, type CSSProperties, type ReactNode } from "react";
import { Play } from "lucide-react";
import { detectEmbed, isEmbeddableUrl, type EmbedDescriptor } from "./embeds/providers";

// hermes 原生两家（YouTube/Spotify）沿用 mirach 上一版的内联匹配——
// 已被用户验证，避免回归；新五家走 provider 目录。
const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/;
const SPOTIFY_RE = /open\.spotify\.com\/(track|album|playlist|episode)\/([\w]+)/;

/** 同意门（hermes EmbedFacade 简化版）：按 embed 占位尺寸留位，无布局跳动 */
function ConsentCard({ descriptor, onApprove }: { descriptor: EmbedDescriptor; onApprove: () => void }) {
  return (
    <button
      onClick={onApprove}
      className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-black/15 bg-black/[0.03] transition-colors hover:bg-black/[0.06]"
      style={descriptor.aspectRatio ? { aspectRatio: descriptor.aspectRatio } : { height: descriptor.height ?? 320 }}
    >
      <span className="flex items-center gap-1.5 rounded-full bg-[#303030] px-3 py-1.5 text-xs text-white">
        <Play className="h-3 w-3 fill-current" />
        加载 {descriptor.label} 嵌入
      </span>
      <span className="text-[11px] text-muted-foreground">
        {(() => { try { return new URL(descriptor.sourceUrl).hostname.replace(/^www\./, ""); } catch { return descriptor.label; } })()}
      </span>
    </button>
  );
}

/** frame 渲染（hermes frame-embed 同款 allow 面） */
function FrameRenderer({ descriptor }: { descriptor: EmbedDescriptor }) {
  const style: CSSProperties = descriptor.aspectRatio
    ? { aspectRatio: descriptor.aspectRatio }
    : { height: descriptor.height };
  const styleWithCap: CSSProperties = descriptor.maxWidth
    ? { ...style, maxWidth: descriptor.maxWidth }
    : style;

  return (
    <iframe
      allow="autoplay; encrypted-media; picture-in-picture; clipboard-write; fullscreen"
      allowFullScreen
      className="block w-full rounded-lg border-0 bg-transparent"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
      scrolling="no"
      src={descriptor.embedUrl}
      style={styleWithCap}
      title={`${descriptor.label} embed`}
    />
  );
}

export function LinkEmbed({ href, children }: { href: string; children?: ReactNode }) {
  // 新 provider 目录优先（国产五家）；YouTube/Spotify 走 legacy 内联匹配
  const descriptor = detectEmbed(href);
  const yt = href.match(YT_RE);
  const sp = href.match(SPOTIFY_RE);

  if (descriptor || yt || sp) {
    return <EmbedCard href={href} descriptor={descriptor} sp={sp} yt={yt}>{children}</EmbedCard>;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-600 underline hover:text-blue-700"
    >
      {children ?? href}
    </a>
  );
}

/** 统一的"同意门 + frame"卡片（hermes UrlEmbed 的 mirach 出口形态） */
function EmbedCard({ href, descriptor, sp, yt, children }: {
  href: string;
  descriptor: ReturnType<typeof detectEmbed>;
  sp: RegExpMatchArray | null;
  yt: RegExpMatchArray | null;
  children?: ReactNode;
}) {
  const [approved, setApproved] = useState(false);

  // 统一描述符：legacy 两家在原地构造同款 FrameEmbed
  const resolved: EmbedDescriptor = descriptor ?? (yt
    ? {
        aspectRatio: 16 / 9,
        embedUrl: `https://www.youtube-nocookie.com/embed/${yt[1]}`,
        id: `youtube:${yt[1]}`,
        label: "YouTube",
        maxWidth: 640,
        provider: "youtube",
        renderer: "frame" as const,
        sourceUrl: href,
      }
    : {
        embedUrl: `https://open.spotify.com/embed/${sp![1]}/${sp![2]}`,
        height: 152,
        id: `spotify:${sp![1]}:${sp![2]}`,
        label: "Spotify",
        maxWidth: 480,
        provider: "spotify",
        renderer: "frame" as const,
        sourceUrl: href,
      });

  return (
    <span className="my-2 block" style={{ maxWidth: resolved.maxWidth ?? 640 }}>
      {approved ? (
        <FrameRenderer descriptor={resolved} />
      ) : (
        <ConsentCard descriptor={resolved} onApprove={() => setApproved(true)} />
      )}
      {children ? <span className="mt-1 block text-xs text-muted-foreground">{children}</span> : null}
    </span>
  );
}

export { isEmbeddableUrl };
