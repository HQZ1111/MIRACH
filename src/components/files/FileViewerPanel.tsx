/**
 * FileViewerPanel — 文件查看器（右侧栏"审查"）
 *
 * 查看代码 / 文档等文件：
 * - Git 变更文件一键打开（无需输入路径）
 * - 手动输入路径打开任意文件
 * 内容按扩展名渲染：.md → Markdown，代码 → highlight.js，其余 → 纯文本。
 *
 * 注：Git 操作（暂存/提交/推送/PR）已移入顶栏下拉 → Git Review 弹窗，
 * 本面板只负责"看文件"。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github.css";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/hooks/useAppConfig";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import {
  ArrowClockwise,
  FolderSimple,
  MagnifyingGlass,
} from "@phosphor-icons/react";

interface GitChange {
  path: string;
  status: string;
  staged: boolean;
}

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "json", "rs", "toml", "py", "css", "html",
  "yaml", "yml", "sh", "ps1", "bat", "txt", "xml", "sql", "go", "java",
  "c", "h", "cpp", "hpp", "vue", "svelte",
]);

type ViewKind = "md" | "code" | "text" | "error";

export function FileViewerPanel() {
  const { config } = useAppConfig();
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [inRepo, setInRepo] = useState<boolean | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [current, setCurrent] = useState<{ path: string; name: string; content: string; kind: ViewKind; loading: boolean } | null>(null);

  // 加载 Git 变更文件列表（供一键打开）
  const refresh = async () => {
    setEnvError(null);
    try {
      const res = await invoke<{ in_repo: boolean; changes: GitChange[] }>("check_git_workspace");
      setInRepo(res.in_repo);
      setChanges(res.changes);
    } catch {
      setEnvError("需要 Tauri 环境（浏览器调试下不可用）");
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const openPath = async (p: string) => {
    const name = p.split(/[\\/]/).pop() || p;
    setCurrent({ path: p, name, content: "", kind: "text", loading: true });
    try {
      const content = await invoke<string>("read_file", { path: p });
      const ext = (name.split(".").pop() || "").toLowerCase();
      const kind: ViewKind = ext === "md" ? "md" : CODE_EXT.has(ext) ? "code" : "text";
      setCurrent({ path: p, name, content, kind, loading: false });
    } catch (e) {
      setCurrent({ path: p, name, content: `读取失败：${String(e)}`, kind: "error", loading: false });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 工作区行 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
        <FolderSimple className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={config.workspace || "未配置工作区"}>
          {config.workspace || "未配置工作区"}
        </span>
        <button
          onClick={() => void refresh()}
          title="刷新"
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted"
        >
          <ArrowClockwise className="h-3 w-3" />
        </button>
      </div>

      {/* 路径输入 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <MagnifyingGlass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && pathInput.trim()) void openPath(pathInput.trim());
          }}
          placeholder="输入文件路径打开（Enter）"
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-body-sm text-[#303030] outline-none transition-colors placeholder:text-muted-foreground focus:border-[#6366F1]"
        />
        <button
          onClick={() => pathInput.trim() && void openPath(pathInput.trim())}
          className="shrink-0 rounded-md bg-[#303030] px-2 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          disabled={!pathInput.trim()}
        >
          打开
        </button>
      </div>

      {/* 变更文件快捷入口 */}
      {envError ? (
        <p className="px-3 pt-4 text-center text-body-sm text-muted-foreground">{envError}</p>
      ) : (
        <div className="shrink-0 border-b border-border px-3 py-1.5">
          <p className="mb-1 text-[10px] font-medium text-muted-foreground">
            Git 变更文件{inRepo ? `（${changes.length}）` : "（当前目录非 Git 仓库）"}
          </p>
          {inRepo && changes.length > 0 ? (
            <div className="max-h-40 space-y-0.5 overflow-y-auto">
              {changes.map((c) => (
                <button
                  key={c.path}
                  onClick={() => void openPath(c.path)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted",
                    current?.path === c.path && "bg-[#E9ECF5]",
                  )}
                  title={c.path}
                >
                  <span className={cn("w-1.5 shrink-0", c.staged ? "bg-[#10B981]" : "bg-[#D1D5DB]")} style={{ height: 12, borderRadius: 2 }} />
                  <span className="w-9 shrink-0 text-[10px] font-medium text-[#EF4444]">{c.status}</span>
                  <span className="min-w-0 flex-1 truncate text-body-sm text-[#303030]">{c.path}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="pb-1 text-[11px] text-muted-foreground/70">
              {inRepo ? "工作区干净，没有变更文件" : "可在上方输入路径查看任意文件"}
            </p>
          )}
        </div>
      )}

      {/* 内容查看 */}
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!current ? (
          <p className="pt-8 text-center text-body-sm text-muted-foreground">
            选择变更文件或输入路径查看内容
          </p>
        ) : current.loading ? (
          <p className="pt-4 text-body-sm text-muted-foreground">读取中…</p>
        ) : current.kind === "md" ? (
          <div className="pt-2">
            <p className="mb-2 border-b border-border pb-1 text-[11px] text-muted-foreground">{current.path}</p>
            <MarkdownText content={current.content} />
          </div>
        ) : current.kind === "code" ? (
          <>
            <p className="mb-2 border-b border-border pb-1 pt-2 text-[11px] text-muted-foreground">{current.path}</p>
            <pre
              className="whitespace-pre-wrap break-all rounded-md border border-black/10 bg-[#F6F8FA] p-2 font-mono text-[11px] leading-relaxed text-[#303030]"
              dangerouslySetInnerHTML={{
                __html:
                  hljs.highlight(current.content, { language: detectLang(current.name), ignoreIllegals: true }).value ||
                  current.content,
              }}
            />
          </>
        ) : (
          <>
            <p className="mb-2 border-b border-border pb-1 pt-2 text-[11px] text-muted-foreground">{current.path}</p>
            <pre className="whitespace-pre-wrap break-all rounded-md border border-black/10 bg-[#F6F8FA] p-2 font-mono text-[11px] leading-relaxed text-[#303030]">
              {current.content}
            </pre>
          </>
        )}
      </div>
    </div>
  );
}

function detectLang(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    rs: "rust", py: "python", json: "json", css: "css", html: "xml",
    yml: "yaml", yaml: "yaml", sh: "bash", ps1: "powershell", bat: "dos",
    sql: "sql", go: "go", java: "java", xml: "xml", toml: "ini",
  };
  return map[ext] ?? "text";
}
