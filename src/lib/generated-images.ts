/**
 * generated-images - 图片生成工具结果解析（S3-5，对应原型 generated-image-result）
 *
 * image_generate 工具返回的 detail 可能是：
 *  - 纯 URL（http/https）
 *  - data URL（base64 内嵌）
 *  - JSON：{ host_image / image / url / data: "…", aspectRatio: "16:9", caption: "…" }
 * DISPLAY_KEYS 依序尝试取图字段。
 */

export interface GeneratedImageData {
  url: string | null;
  aspectRatio: string | null;
  caption: string | null;
}

/** 图片字段候选（按优先级） */
export const DISPLAY_KEYS = ["host_image", "image", "url", "data"] as const;

export function parseGeneratedImage(detail: string | undefined): GeneratedImageData | null {
  if (!detail) return null;
  const trimmed = detail.trim();
  if (!trimmed) return null;

  // data URL / 纯 URL
  if (trimmed.startsWith("data:")) {
    return { url: trimmed, aspectRatio: null, caption: null };
  }
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    return { url: trimmed, aspectRatio: null, caption: null };
  }

  // JSON（可能带 markdown 代码块包裹）
  const jsonText = trimmed.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    if (obj && typeof obj === "object") {
      for (const k of DISPLAY_KEYS) {
        const v = obj[k];
        if (typeof v === "string" && v.trim()) {
          return {
            url: v.trim(),
            aspectRatio: typeof obj.aspectRatio === "string" ? obj.aspectRatio : null,
            caption: typeof obj.caption === "string" ? obj.caption : null,
          };
        }
      }
    }
  } catch {
    /* 非 JSON：按文本处理（无图可显） */
  }
  return null;
}

/** aspectRatio 字符串（"16:9" / "1:1" / "9:16"）→ CSS aspect-ratio 值；缺省 1 */
export function aspectRatioValue(hint: string | null): string {
  if (!hint) return "1";
  const m = /^(\d+)\s*[/:x×]\s*(\d+)$/i.exec(hint.trim());
  if (m) return `${m[1]} / ${m[2]}`;
  return "1";
}
