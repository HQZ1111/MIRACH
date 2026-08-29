/**
 * CodeBlock - 代码块（带复制按钮和语言标签）
 *
 * react-markdown 的 `pre` 组件，包裹高亮后的 <code>。
 */

import { useState, type ComponentProps, type ReactElement } from "react";
import { Check, Copy } from "lucide-react";

type PreProps = ComponentProps<"pre"> & {
  children?: ReactElement<{ className?: string }>;
};

export function CodeBlock(props: PreProps) {
  const [copied, setCopied] = useState(false);
  const { children, ...rest } = props;

  // 从子元素 <code> 提取语言
  const codeEl = children as
    | ReactElement<{ className?: string; children?: React.ReactNode }>
    | undefined;
  const className = codeEl?.props?.className ?? "";
  const match = /language-(\w+)/.exec(className);
  const lang = match?.[1] ?? "text";

  const handleCopy = () => {
    // 从 DOM 提取纯文本
    const el = document.createElement("pre");
    el.innerHTML = (codeEl?.props?.children as string) ?? "";
    navigator.clipboard.writeText(el.textContent ?? "");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-black/10 bg-[#f6f8fa]">
      {/* 头部：语言标签 + 复制按钮 */}
      <div className="flex items-center justify-between border-b border-black/5 px-3 py-1">
        <span className="text-[11px] font-medium text-muted-foreground">{lang}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-[#303030]"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {/* 代码内容（rehype-highlight 已注入 hljs 类） */}
      <pre
        {...rest}
        className="overflow-x-auto p-3 text-[13px] leading-relaxed [&_code]:bg-transparent [&_code]:p-0"
      >
        {children}
      </pre>
    </div>
  );
}
