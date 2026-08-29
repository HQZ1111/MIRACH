/**
 * Mermaid — mermaid 图渲染（```mermaid 围栏）
 *
 * 使用 mermaid.render 异步生成 SVG，失败时显示错误。
 * mermaid 体积较大，采用动态 import 按需加载（渲染时才拉取 chunk）。
 */

import { useEffect, useState } from "react";

let initialized = false;

function ensureInit(mermaid: { initialize: (cfg: Record<string, unknown>) => void }): void {
  if (initialized) return;
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    theme: "default",
    securityLevel: "loose",
    fontFamily: "inherit",
  });
}

export function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void import("mermaid")
      .then(({ default: mermaid }) => {
        ensureInit(mermaid);
        const id = `hermes-mermaid-${Math.random().toString(36).slice(2, 10)}`;
        return mermaid.render(id, code).then(({ svg: out }: { svg: string }) => {
          if (alive) {
            setSvg(out);
            setError(null);
          }
        });
      })
      .catch((e: unknown) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-600">
        mermaid 渲染失败：{error}
      </div>
    );
  }
  if (!svg) {
    return <div className="my-2 rounded-lg border border-black/10 bg-muted/20 p-2 text-xs text-muted-foreground">渲染中…</div>;
  }
  return (
    <div
      className="my-2 overflow-auto rounded-lg border border-black/10 bg-white p-2"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
