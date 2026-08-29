/**
 * ArtifactsPanel — 产物图库（右侧栏）
 *
 * 展示聊天中收集的产物（HTML / SVG / 代码 / 链接），
 * 点击卡片 → 预览：HTML/SVG 走 sandbox iframe srcDoc，代码走 highlight.js，链接打开外部。
 *
 * mock 模式首次挂载会注入演示产物；VITE_MOCK=0 时等待真实后端消息事件。
 */

import { useEffect, useMemo, useState } from "react";
import { useStore } from "@nanostores/react";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import { $artifacts, addArtifacts } from "@/store/artifacts";
import { detectArtifacts, type Artifact, type ArtifactKind } from "@/lib/artifact-detect";
import { MOCK } from "@/lib/mock";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import {
  ArrowUpRight,
  FileCode,
  Globe,
  Image,
  X,
} from "@phosphor-icons/react";

const KIND_LABEL: Record<ArtifactKind, string> = {
  html: "HTML",
  svg: "SVG",
  code: "代码",
  link: "链接",
};

const TABS: ("all" | ArtifactKind)[] = ["all", "html", "svg", "code", "link"];

// mock 模式演示产物（接真实后端后删除）
const DEMO_TEXT = `
先给一个数据面板示例：

\`\`\`html
<!DOCTYPE html>
<html><head><title>用量概览</title><style>
body{font-family:system-ui;margin:24px;color:#1f2937}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px}
.num{font-size:28px;font-weight:700;color:#6366f1}
</style></head><body>
<div class="card"><div class="num">98,240</div><div>本月 Token</div></div>
<div class="card"><div class="num">1,284</div><div>调用次数</div></div>
</body></html>
\`\`\`

以及一个图表：

\`\`\`svg
<svg width="320" height="120" xmlns="http://www.w3.org/2000/svg">
  <rect x="10" y="60" width="40" height="50" rx="6" fill="#6366f1"/>
  <rect x="70" y="40" width="40" height="70" rx="6" fill="#8b5cf6"/>
  <rect x="130" y="20" width="40" height="90" rx="6" fill="#10b981"/>
  <text x="10" y="110" font-size="10" fill="#9ca3af">Mon</text>
  <text x="70" y="110" font-size="10" fill="#9ca3af">Tue</text>
  <text x="130" y="110" font-size="10" fill="#9ca3af">Wed</text>
</svg>
\`\`\`

还有一段配置：

\`\`\`ts
export const config = {
  provider: "openai",
  model: "gpt-4o",
  temperature: 0.2,
};
\`\`\`
`;

export function ArtifactsPanel() {
  const artifacts = useStore($artifacts);
  const [tab, setTab] = useState<"all" | ArtifactKind>("all");
  const [preview, setPreview] = useState<Artifact | null>(null);

  // mock 模式注入演示产物（只注入一次）
  useEffect(() => {
    if (MOCK && $artifacts.get().length === 0) {
      addArtifacts(detectArtifacts(DEMO_TEXT, "demo"));
    }
  }, []);

  const visible = useMemo(
    () => artifacts.filter((a) => tab === "all" || a.kind === tab),
    [artifacts, tab],
  );

  const kindIcon = (k: ArtifactKind) => {
    switch (k) {
      case "html":
        return <Globe className="h-4 w-4" />;
      case "svg":
        return <Image className="h-4 w-4" />;
      case "code":
        return <FileCode className="h-4 w-4" />;
      case "link":
        return <ArrowUpRight className="h-4 w-4" />;
    }
  };

  const openPreview = (a: Artifact) => {
    if (a.kind === "link") {
      if (a.url) void openUrl(a.url).catch(() => window.open(a.url, "_blank"));
      return;
    }
    setPreview(a);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：类型标签 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "rounded-md px-2 py-0.5 text-[11px] transition-colors",
              tab === t
                ? "bg-[#E9ECF5] font-medium text-[#303030]"
                : "text-muted-foreground hover:bg-black/[0.04]",
            )}
          >
            {t === "all" ? "全部" : KIND_LABEL[t]}
          </button>
        ))}
      </div>

      {/* 产物列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {visible.length === 0 ? (
          <p className="pt-8 text-center text-body-sm text-muted-foreground">
            暂无产物
            <br />
            <span className="text-[11px]">聊天中出现 HTML/SVG/代码块后会自动收集</span>
          </p>
        ) : (
          <div className="space-y-1">
            {visible.map((a) => (
              <button
                key={a.id}
                onClick={() => openPreview(a)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                  preview?.id === a.id ? "bg-[#E9ECF5]" : "hover:bg-muted",
                )}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-black/[0.04] text-[#464646]">
                  {kindIcon(a.kind)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm text-[#303030]">{a.title}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {KIND_LABEL[a.kind]}
                    {a.language ? ` · ${a.language}` : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 预览 */}
      {preview && (
        <div className="flex max-h-[46%] shrink-0 flex-col border-t border-border">
          <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#303030]">
              {preview.title}
            </span>
            <button
              onClick={() => setPreview(null)}
              title="关闭预览"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
            {preview.kind === "html" || preview.kind === "svg" ? (
              <iframe
                title={preview.title}
                sandbox="allow-scripts"
                srcDoc={preview.content}
                className="h-full min-h-[160px] w-full rounded-md border border-border bg-white"
              />
            ) : (
              <pre
                className="whitespace-pre-wrap break-all rounded-md border border-border bg-[#F6F8FA] p-2 font-mono text-[11px] leading-relaxed text-[#303030]"
                dangerouslySetInnerHTML={{
                  __html:
                    hljs.highlight(preview.content, {
                      language: (preview.language as never) || "text",
                      ignoreIllegals: true,
                    }).value || preview.content,
                }}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
