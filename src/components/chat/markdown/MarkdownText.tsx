/**
 * MarkdownText - Markdown 渲染器
 *
 * 支持 GFM（表格/删除线/任务列表）、语法高亮、可缩放图片、
 * KaTeX 数学公式（$$...$$）、mermaid 图（```mermaid）、
 * URL/YouTube/Spotify 富嵌入（Embeds）。
 * 使用 Tailwind 工具类样式化各元素，无需额外 CSS。
 *
 * highlightMentions：渲染层把文本中的 @提及 包成 .mention-token 高亮
 * （rehype 阶段构建 span 元素，不引入 raw HTML 渲染，安全）。
 */

import { memo, type ReactElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import "highlight.js/styles/github.css";
import "katex/dist/katex.min.css";
import { CodeBlock } from "./CodeBlock";
import { ZoomableImage } from "./ZoomableImage";
import { LinkEmbed } from "./Embeds";
import { Mermaid } from "./Mermaid";
import { TerminalOutput } from "../tool-call/TerminalOutput";

// @提及匹配：@后跟字母/数字/中文/点/连字符（不含空格和@）
const MENTION_RE = /(@[\w\u4e00-\u9fa5.-]+)/g;

/** rehype 插件：把文本节点中的 @提及 拆出来包成 span.mention-token（hast 层构建，安全） */
function rehypeMention() {
  return (tree: unknown) => {
    const walk = (node: { children?: unknown[] } | null) => {
      if (!node || !Array.isArray(node.children)) return;
      node.children = node.children.flatMap((c) => {
        const child = c as { type?: string; children?: unknown[]; value?: string };
        if (child.type === "text" && typeof child.value === "string") {
          const parts = child.value.split(MENTION_RE);
          if (parts.length <= 1) return [c];
          return parts.map((p) =>
            p && p.startsWith("@")
              ? {
                  type: "element",
                  tagName: "span",
                  properties: { className: ["mention-token"] },
                  children: [{ type: "text", value: p }],
                }
              : { type: "text", value: p },
          );
        }
        walk(child as { children?: unknown[] } | null);
        return [c];
      });
    };
    walk(tree as { children?: unknown[] } | null);
  };
}

/** rehype 插件：会话内查找——hast 层把命中词包成 mark.find-highlight，跳过 code/pre（不破坏代码块） */
function rehypeFindTerm(findTerm: string) {
  return (tree: unknown) => {
    const q = findTerm.trim().toLowerCase();
    if (!q) return;
    const qe = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${qe})`, "gi");
    const walk = (
      node: { type?: string; tagName?: string; children?: unknown[]; value?: string } | null,
      inCode = false,
    ) => {
      if (!node) return;
      const skip = inCode || node.tagName === "code" || node.tagName === "pre";
      if (node.type === "text" && typeof node.value === "string" && !skip) {
        const value = node.value;
        const matches = [...value.matchAll(re)];
        if (matches.length === 0) return;
        const children: unknown[] = [];
        let last = 0;
        for (const m of matches) {
          const idx = m.index ?? 0;
          if (idx > last) children.push({ type: "text", value: value.slice(last, idx) });
          children.push({
            type: "element",
            tagName: "mark",
            properties: { className: ["find-highlight"] },
            children: [{ type: "text", value: m[0] }],
          });
          last = idx + m[0].length;
        }
        if (last < value.length) children.push({ type: "text", value: value.slice(last) });
        node.type = "element";
        node.tagName = "span";
        node.children = children;
        return;
      }
      if (Array.isArray(node.children)) {
        node.children.forEach((c) => walk(c as typeof node, skip));
      }
    };
    walk(tree as { type?: string; tagName?: string; children?: unknown[]; value?: string } | null);
  };
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="text-lg font-bold mb-2 mt-3 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-base font-bold mb-2 mt-3 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-sm font-bold mb-1.5 mt-2 first:mt-0">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 break-words leading-relaxed last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="list-disc ml-5 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal ml-5 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ href, children }) => <LinkEmbed href={href ?? ""}>{children}</LinkEmbed>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-muted-foreground/30 pl-3 italic text-muted-foreground mb-2">
      {children}
    </blockquote>
  ),
  pre: (props) => {
    // ```mermaid 围栏 → 渲染为图表（不进代码块）
    const codeEl = (props as { children?: ReactElement }).children as
      | ReactElement<{ className?: string; children?: ReactNode }>
      | undefined;
    const lang = (codeEl?.props?.className ?? "").replace("language-", "").trim();
    const raw = String(codeEl?.props?.children ?? "").replace(/\n$/, "");
    if (lang === "mermaid") {
      return <Mermaid code={raw} />;
    }
    // ```terminal / ```sh 输出 → 终端输出视图（等宽不换行 + 自动跟随）
    if (lang === "terminal" || lang === "console-output") {
      return <TerminalOutput text={raw} />;
    }
    return <CodeBlock {...(props as any)} />;
  },
  code: ({ className, children }) => {
    // 行内代码（无 className）
    if (!className) {
      return (
        <code className="rounded bg-muted px-1 py-0.5 text-[13px] font-mono">
          {children}
        </code>
      );
    }
    // 块代码（rehype-highlight 已注入 hljs 类）
    return <code className={className}>{children}</code>;
  },
  img: (props) => <ZoomableImage {...(props as any)} />,
  table: ({ children }) => (
    <table className="my-2 border-collapse text-[13px]">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-black/10 px-2 py-1 font-medium bg-muted/30">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-black/10 px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="my-3 border-t border-black/10" />,
};

// memo：content 不变时跳过重渲染（react-markdown 每次渲染都会重新解析，
// 400 条消息的聊天里必须避免无关重渲染带来的卡顿）
export const MarkdownText = memo(function MarkdownText({
  content,
  highlightMentions = false,
  findTerm,
}: {
  content: string;
  /** 渲染层高亮文本中的 @提及（.mention-token） */
  highlightMentions?: boolean;
  /** 会话内查找：hast 层高亮命中词（.find-highlight，跳过 code/pre）；空串不启用 */
  findTerm?: string;
}) {
  return (
    <Markdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        [rehypeHighlight, { ignoreMissing: true } as never],
        rehypeKatex as never,
        ...(highlightMentions ? [rehypeMention as never] : []),
        ...(findTerm && findTerm.trim() ? [rehypeFindTerm(findTerm) as never] : []),
      ]}
      components={components}
    >
      {content}
    </Markdown>
  );
});
