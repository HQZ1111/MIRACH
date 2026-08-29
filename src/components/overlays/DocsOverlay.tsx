/**
 * DocsOverlay — 产品文档弹窗（顶栏下拉打开）
 *
 * 列出工作区 docs/ 目录下的 Markdown 文档，点击查看渲染后的内容；
 * 也支持直接输入路径打开任意 .md 文件。
 * 数据来自 Tauri read_dir / read_file（非 Tauri 环境显示提示）。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/hooks/useAppConfig";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import { OverlayShell } from "./OverlayShell";
import { BookOpen, FileText, FolderSimple, MagnifyingGlass } from "@phosphor-icons/react";

interface DocFile {
  name: string;
  path: string;
}

export function DocsOverlay({ onClose }: { onClose: () => void }) {
  const { config } = useAppConfig();
  const [docs, setDocs] = useState<DocFile[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [pathInput, setPathInput] = useState("");
  const [current, setCurrent] = useState<{ name: string; content: string; loading: boolean } | null>(null);

  const workspace = config.workspace || "";

  // 列出工作区 docs/ 下的 .md 文档
  useEffect(() => {
    if (!workspace) return;
    let alive = true;
    setListError(null);
    void invoke<{ name: string; path: string; is_dir: boolean }[]>("read_dir", {
      path: `${workspace}\\docs`,
    })
      .then((list) => {
        if (!alive) return;
        setDocs(
          list
            .filter((e) => !e.is_dir && e.name.toLowerCase().endsWith(".md"))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      })
      .catch(() => {
        if (alive) setListError("工作区 docs/ 目录不存在或不可读（可在下方输入路径打开文档）");
      });
    return () => {
      alive = false;
    };
  }, [workspace]);

  const openDoc = async (path: string, name: string) => {
    setCurrent({ name, content: "", loading: true });
    try {
      const content = await invoke<string>("read_file", { path });
      setCurrent({ name, content, loading: false });
    } catch (e) {
      setCurrent({ name, content: `读取失败：${String(e)}`, loading: false });
    }
  };

  return (
    <OverlayShell title="产品文档" width={980} height={680} onClose={onClose}>
      <div className="flex h-full min-h-0">
        {/* 左侧文档列表 */}
        <div className="flex w-64 shrink-0 flex-col border-r border-border">
          <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
            <FolderSimple className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={`${workspace}\\docs`}>
              docs/
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {listError ? (
              <p className="p-2 text-[11px] leading-relaxed text-muted-foreground">{listError}</p>
            ) : docs.length === 0 ? (
              <p className="p-2 text-[11px] text-muted-foreground">没有 .md 文档</p>
            ) : (
              docs.map((d) => (
                <button
                  key={d.path}
                  onClick={() => void openDoc(d.path, d.name)}
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors",
                    current?.name === d.name ? "bg-[#E9ECF5]" : "hover:bg-muted",
                  )}
                  title={d.path}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-[#303030]">{d.name}</span>
                </button>
              ))
            )}
          </div>
          {/* 路径打开 */}
          <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2">
            <MagnifyingGlass className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pathInput.trim()) {
                  void openDoc(pathInput.trim(), pathInput.trim().split(/[\\/]/).pop() || pathInput.trim());
                }
              }}
              placeholder="路径打开 .md（Enter）"
              className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1 text-[11px] text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
            />
          </div>
        </div>

        {/* 右侧内容 */}
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {!current ? (
            <p className="pt-10 text-center text-body-sm text-muted-foreground">
              <BookOpen className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
              选择左侧文档查看内容
            </p>
          ) : current.loading ? (
            <p className="pt-4 text-body-sm text-muted-foreground">读取中…</p>
          ) : (
            <MarkdownText content={current.content} />
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
