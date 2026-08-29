/**
 * GeneratedImage — 图片生成结果（S3-5，对应原型 generated-image-result）
 *
 * 预占位 → DiffusionCanvas（pending，等待引擎返回）→ 图片加载完成展示。
 * aspectRatio hint（16:9 / 1:1 / 9:16）决定占位纵横比，加载后按图片自然尺寸覆盖。
 * 提供下载按钮 + 点击灯箱放大。
 */

import { useMemo, useState } from "react";
import { Download, Maximize2, X } from "lucide-react";
import { DiffusionCanvas } from "./DiffusionCanvas";
import { aspectRatioValue, parseGeneratedImage } from "@/lib/generated-images";

interface GeneratedImageProps {
  /** image_generate 工具返回的 detail 原文（URL / dataURL / JSON） */
  result?: string;
  /** 纵横比提示（工具返回 aspectRatio 字段） */
  aspectRatio?: string | null;
}

export function GeneratedImage({ result, aspectRatio }: GeneratedImageProps) {
  const data = useMemo(() => {
    const parsed = parseGeneratedImage(result);
    if (parsed) return parsed;
    return aspectRatio ? { url: null, aspectRatio, caption: null } : null;
  }, [result, aspectRatio]);

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  // 无 URL：保持占位（等待引擎返回图片）
  if (!data?.url) {
    return (
      <div
        className="relative w-64 overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: aspectRatioValue(data?.aspectRatio ?? null) }}
      >
        <div className="absolute inset-0">
          <DiffusionCanvas />
        </div>
        <p className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-[10px] text-white/80">
          正在生成图片…
        </p>
      </div>
    );
  }

  const iconBtn =
    "flex h-6 w-6 items-center justify-center rounded-md bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70";

  return (
    <>
      <div
        className="relative w-64 overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: loaded ? undefined : aspectRatioValue(data.aspectRatio) }}
      >
        {!loaded && (
          <div className="absolute inset-0">
            <DiffusionCanvas />
          </div>
        )}
        <img
          src={data.url}
          alt={data.caption ?? "生成图片"}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          onClick={() => setLightbox(true)}
          className={`block w-full cursor-zoom-in ${loaded ? "" : "opacity-0"} ${error ? "hidden" : ""}`}
        />
        {error && (
          <p className="p-2 text-[11px] text-muted-foreground">
            图片加载失败：{data.url.length > 48 ? `${data.url.slice(0, 48)}…` : data.url}
          </p>
        )}
        {loaded && (
          <div className="absolute right-1 top-1 flex gap-1">
            <a href={data.url} download title="下载图片" className={iconBtn} onClick={(e) => e.stopPropagation()}>
              <Download className="h-3 w-3" strokeWidth={2} />
            </a>
            <button onClick={() => setLightbox(true)} title="放大" className={iconBtn}>
              <Maximize2 className="h-3 w-3" strokeWidth={2} />
            </button>
          </div>
        )}
        {data.caption && (
          <p className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1 text-[10px] text-white/80">
            {data.caption}
          </p>
        )}
      </div>

      {/* 灯箱 */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/85 backdrop-blur-md"
          onClick={() => setLightbox(false)}
        >
          <button
            onClick={() => setLightbox(false)}
            title="关闭"
            className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
          <img
            src={data.url}
            alt={data.caption ?? "生成图片"}
            className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
