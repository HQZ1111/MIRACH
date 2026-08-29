/**
 * Embeds — URL 富嵌入（YouTube / Spotify）+ 外链同意机制
 *
 * 对齐 hermes-agent-main apps/desktop 的 embeds/url-embed + embed-consent：
 * - YouTube 链接 → 点击"加载嵌入"后渲染 youtube-nocookie iframe（同意后才加载外链）
 * - Spotify 链接 → 点击后渲染 open.spotify.com/embed iframe
 * - 其余链接保持普通超链接
 *
 * 注：mermaid / KaTeX 数学需要额外依赖（mermaid / remark-math + rehype-katex），
 * 当前版本暂未引入（见 docs/api-contract.md 的后续项）。
 */

import { useState, type ReactNode } from "react";
import { Globe } from "@phosphor-icons/react";

const YT_RE = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/;
const SPOTIFY_RE = /open\.spotify\.com\/(track|album|playlist|episode)\/([\w]+)/;

/** 同意门：点击后才加载第三方嵌入（隐私保护，对齐原型 embed-consent） */
function ConsentCard({ label, onApprove }: { label: string; onApprove: () => void }) {
  return (
    <button
      onClick={onApprove}
      className="flex w-full items-center gap-2 rounded-lg border border-black/10 bg-black/[0.03] px-3 py-2.5 text-left transition-colors hover:bg-black/[0.05]"
    >
      <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate text-body-sm text-[#303030]">{label}</span>
      <span className="shrink-0 rounded bg-[#303030] px-2 py-0.5 text-[10px] text-white">加载嵌入</span>
    </button>
  );
}

export function LinkEmbed({ href, children }: { href: string; children?: ReactNode }) {
  const [approved, setApproved] = useState(false);
  const yt = href.match(YT_RE);
  const sp = href.match(SPOTIFY_RE);

  if (yt) {
    const id = yt[1];
    return (
      <span className="my-2 block">
        {approved ? (
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${id}`}
            title="YouTube 视频"
            className="aspect-video w-full rounded-lg border border-black/10"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        ) : (
          <ConsentCard label={`YouTube 视频（${id}）`} onApprove={() => setApproved(true)} />
        )}
      </span>
    );
  }

  if (sp) {
    return (
      <span className="my-2 block">
        {approved ? (
          <iframe
            src={`https://open.spotify.com/embed/${sp[1]}/${sp[2]}`}
            title="Spotify"
            className="h-20 w-full rounded-lg border border-black/10"
            allow="encrypted-media"
          />
        ) : (
          <ConsentCard label="Spotify 音乐" onApprove={() => setApproved(true)} />
        )}
      </span>
    );
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
