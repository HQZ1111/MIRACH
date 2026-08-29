/**
 * PreviewPanel — 右侧栏「预览」面板（对应原型右轨 preview-file / artifact）
 *
 * 订阅 $previewTarget（状态栈 PreviewRow / 浏览器 / 产物可 setPreviewUrl 展示）：
 * - http(s) 链接 → iframe 内嵌预览
 * - 其余文本 → 等宽文本展示
 * 空目标 → 提示如何触发预览。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStore } from "@nanostores/react";
import { $previewTarget, clearPreview } from "@/store/preview";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";

export function PreviewPanel() {
  const target = useStore($previewTarget);
  // 本地文件路径 → 读内容展示（md 用 MarkdownText 渲染；read_file >2MB 报错友好提示）
  const isLocal = !!target && !/^https?:\/\//i.test(target.url) && /^[A-Za-z]:[\\/]/.test(target.url);
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setContent(null);
    setErr(null);
    if (!target || !isLocal) return;
    let cancelled = false;
    void invoke<string>("read_file", { path: target.url })
      .then((text) => {
        if (!cancelled) setContent(text);
      })
      .catch((e) => {
        if (!cancelled) setErr(typeof e === "string" ? e : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [target?.url, isLocal]);

  const isMd = !!target && /\.(md|markdown)$/i.test(target.url);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h3 className="text-member font-medium text-[#303030]">预览</h3>
        {target && (
          <button
            onClick={clearPreview}
            title="清除预览"
            className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-[#303030]"
          >
            清除
          </button>
        )}
      </div>
      {!target ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-body-sm text-muted-foreground">暂无预览内容</p>
          <p className="max-w-60 text-[11px] leading-relaxed text-muted-foreground/80">
            状态栈「预览」行、浏览器或产物点击「预览」后，内容会出现在这里。
          </p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {target.label && (
            <p className="shrink-0 truncate border-b border-border/60 px-4 py-1.5 text-[11px] text-muted-foreground" title={target.label}>
              {target.label}
            </p>
          )}
          {/^https?:\/\//i.test(target.url) ? (
            <iframe
              src={target.url}
              title={target.label ?? "预览"}
              className="min-h-0 flex-1 border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          ) : isLocal ? (
            err ? (
              <p className="px-4 py-3 text-[11px] text-[#EF4444]">{err}</p>
            ) : content === null ? (
              <p className="px-4 py-3 text-[11px] text-muted-foreground">正在读取文件…</p>
            ) : isMd ? (
              <div className="min-h-0 flex-1 overflow-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <MarkdownText content={content} />
              </div>
            ) : (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-relaxed text-[#303030] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {content}
              </pre>
            )
          ) : (
            <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all px-4 py-3 font-mono text-[11px] leading-relaxed text-[#303030] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {target.url}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
