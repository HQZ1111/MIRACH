/**
 * FilesPanel — 文件浏览器（右侧栏）
 *
 * 真实文件树（懒加载目录）：
 * - 根目录 = 配置的项目工作目录（useAppConfig.workspace）
 * - 展开目录 → read_dir 拉取子项；点击文件 → read_file 读取内容预览
 * - 右键菜单：重命名 / 删除 / 在资源管理器中显示 / 复制路径 / 添加到对话（@file 引用）
 * - 拖拽文件行到外部 → mirach:composer-attach 事件（Composer 接收为文件附件）
 *
 * 删除/重命名是破坏性操作，均带确认。非 Tauri 环境（浏览器调试）显示占位。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import {
  ArrowClockwise,
  CaretRight,
  Copy,
  DotsThreeVertical,
  FileCode,
  FileText,
  Folder,
  FolderOpen,
  MagnifyingGlass,
  PencilSimple,
  Trash,
  Upload,
} from "@phosphor-icons/react";
import { useAppConfig } from "@/hooks/useAppConfig";
import { openPrompt } from "@/store/prompt-dialog";

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

interface ContextTarget {
  path: string;
  name: string;
  isDir: boolean;
}

/** 常见代码/文本扩展名（决定预览图标） */
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "json", "md", "rs", "toml", "py", "css", "html",
  "yaml", "yml", "sh", "ps1", "bat", "txt", "xml", "svg", "sql", "go", "java",
  "c", "h", "cpp", "hpp", "vue", "svelte",
]);

function iconFor(name: string, isDir: boolean) {
  if (isDir) return null; // 用展开态图标
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return CODE_EXT.has(ext) ? FileCode : FileText;
}

export function FilesPanel() {
  const { config } = useAppConfig();
  // 根目录：配置的工作目录；非 Tauri 环境回退 C:\
  const root = useMemo(() => config.workspace || "C:\\", [config.workspace]);

  // 已加载的目录内容（path → entries）
  const [dirs, setDirs] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{ path: string; name: string; content: string; loading: boolean } | null>(null);
  // 右键菜单
  const [menu, setMenu] = useState<{ x: number; y: number; target: ContextTarget } | null>(null);
  const [supported, setSupported] = useState(true);

  // 非 Tauri 环境（invoke 失败）标记
  const fail = useCallback(() => setSupported(false), []);

  // 首次挂载：加载根目录
  useEffect(() => {
    let alive = true;
    void invoke<FileEntry[]>("read_dir", { path: root })
      .then((list) => alive && setDirs((d) => ({ ...d, [root]: list })))
      .catch(fail);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [root]);

  const toggleDir = (path: string) => {
    if (!dirs[path] && !loadingDirs.has(path)) {
      setLoadingDirs((s) => new Set(s).add(path));
      void invoke<FileEntry[]>("read_dir", { path })
        .then((list) => {
          setDirs((d) => ({ ...d, [path]: list }));
          setLoadingDirs((s) => {
            const next = new Set(s);
            next.delete(path);
            return next;
          });
        })
        .catch(() => {
          setLoadingDirs((s) => {
            const next = new Set(s);
            next.delete(path);
            return next;
          });
        });
    }
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const openFile = (path: string, name: string) => {
    setPreview({ path, name, content: "", loading: true });
    void invoke<string>("read_file", { path })
      .then((content) => setPreview({ path, name, content, loading: false }))
      .catch((e: string) => setPreview({ path, name, content: `读取失败：${e}`, loading: false }));
  };

  // 递归渲染树（缩进 = depth）
  const renderNode = (entry: FileEntry, depth: number): React.ReactNode => {
    const isOpen = expanded.has(entry.path);
    const children = dirs[entry.path];
    const Icon = iconFor(entry.name, entry.is_dir);
    return (
      <div key={entry.path}>
        <div
          className={cn(
            "group flex cursor-default items-center gap-1 rounded-md pr-1 text-body-sm leading-[26px]",
            preview?.path === entry.path ? "bg-[#E9ECF5]" : "hover:bg-black/[0.04]",
          )}
          style={{ paddingLeft: depth * 14 + 6 }}
          onClick={() => (entry.is_dir ? toggleDir(entry.path) : openFile(entry.path, entry.name))}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, target: { path: entry.path, name: entry.name, isDir: entry.is_dir } });
          }}
          draggable={!entry.is_dir}
          onDragStart={(e) => {
            e.dataTransfer.setData("text/plain", entry.path);
            e.dataTransfer.effectAllowed = "copy";
            // 拖出文件：通知 Composer 作为文件附件
            window.dispatchEvent(
              new CustomEvent("mirach:composer-attach", {
                detail: { kind: "file", label: entry.name, detail: entry.path, content: entry.path },
              }),
            );
          }}
          title={entry.path}
        >
          <span className="flex h-6 w-4 shrink-0 items-center justify-center text-muted-foreground">
            {entry.is_dir ? (
              isOpen ? <CaretRight className="rotate-90 h-3 w-3" /> : <CaretRight className="h-3 w-3" />
            ) : null}
          </span>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[#6B7280]">
            {entry.is_dir ? (
              isOpen ? <FolderOpen className="h-4 w-4" weight="fill" /> : <Folder className="h-4 w-4" weight="fill" />
            ) : Icon ? (
              <Icon className="h-3.5 w-3.5" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[#303030]">{entry.name}</span>
          <button
            className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-black/5 group-hover:flex"
            title="更多操作"
            onClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setMenu({ x: r.right - 160, y: r.bottom + 4, target: { path: entry.path, name: entry.name, isDir: entry.is_dir } });
            }}
          >
            <DotsThreeVertical className="h-3.5 w-3.5" />
          </button>
        </div>
        {entry.is_dir && isOpen && (
          <div>
            {loadingDirs.has(entry.path) ? (
              <div className="py-1 pl-6 text-xs text-muted-foreground">加载中…</div>
            ) : children ? (
              children.map((c) => renderNode(c, depth + 1))
            ) : (
              <div className="py-1 pl-6 text-xs text-muted-foreground">（空）</div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ---- 右键菜单动作 ----
  const runAction = async (action: "rename" | "delete" | "reveal" | "copy" | "attach") => {
    if (!menu) return;
    const { path, name } = menu.target;
    setMenu(null);
    switch (action) {
      case "rename": {
        const next = await openPrompt({ title: "重命名", initialValue: name, confirmText: "重命名" });
        if (!next || next === name) return;
        const dir = path.slice(0, path.length - name.length);
        void invoke("rename_path", { from: path, to: dir + next }).catch((e: string) => window.alert(`重命名失败：${e}`));
        // 重命名后刷新父目录
        const parent = dir.replace(/[\\/]$/, "") || root;
        void invoke<FileEntry[]>("read_dir", { path: parent }).then((list) => setDirs((d) => ({ ...d, [parent]: list })));
        break;
      }
      case "delete": {
        if (!window.confirm(`确定删除 ${name} ？此操作不可撤销。`)) return;
        void invoke("delete_path", { path }).then(() => {
          const parent = path.slice(0, path.length - name.length).replace(/[\\/]$/, "") || root;
          void invoke<FileEntry[]>("read_dir", { path: parent }).then((list) => setDirs((d) => ({ ...d, [parent]: list })));
        }).catch((e: string) => window.alert(`删除失败：${e}`));
        break;
      }
      case "reveal":
        void invoke("reveal_path", { path }).catch(() => {});
        break;
      case "copy":
        void navigator.clipboard.writeText(path).catch(() => {});
        break;
      case "attach":
        window.dispatchEvent(
          new CustomEvent("mirach:composer-attach", {
            detail: { kind: "file", label: name, detail: path, content: path },
          }),
        );
        break;
    }
  };

  const entries = dirs[root] ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部：根目录 + 刷新 */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 py-2">
        <Folder className="h-3.5 w-3.5 text-[#6B7280]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#303030]">{root}</span>
        <button
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-black/5"
          title="刷新"
          onClick={() => {
            setDirs({});
            setExpanded(new Set());
            setPreview(null);
          }}
        >
          <ArrowClockwise className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* 文件树 */}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {!supported ? (
          <div className="p-3 text-xs text-muted-foreground">
            文件浏览需要 Tauri 环境（浏览器调试下不可用）。
          </div>
        ) : entries.length === 0 ? (
          <div className="flex items-center gap-1.5 p-3 text-xs text-muted-foreground">
            <MagnifyingGlass className="h-3.5 w-3.5" />
            目录为空或不可读
          </div>
        ) : (
          entries.map((e) => renderNode(e, 0))
        )}
      </div>

      {/* 预览区 */}
      {preview && (
        <div className="flex max-h-[40%] shrink-0 flex-col border-t border-border">
          <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#303030]">{preview.name}</span>
            <button
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5"
              title="关闭预览"
              onClick={() => setPreview(null)}
            >
              <DotsThreeVertical className="h-3.5 w-3.5 rotate-90" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
            {preview.loading ? (
              <p className="text-xs text-muted-foreground">读取中…</p>
            ) : (
              <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[#303030]">
                {preview.content}
              </pre>
            )}
          </div>
        </div>
      )}

      {/* 右键菜单（fixed 定位） */}
      {menu && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div
            className="panel-glass menu-anim fixed z-30 w-44 rounded-xl p-1"
            style={{ left: Math.min(menu.x, window.innerWidth - 190), top: Math.min(menu.y, window.innerHeight - 200) }}
          >
            {[
              { key: "attach", icon: Upload, label: "添加到对话（@file）" },
              { key: "reveal", icon: MagnifyingGlass, label: "在资源管理器中显示" },
              { key: "copy", icon: Copy, label: "复制路径" },
              { key: "rename", icon: PencilSimple, label: "重命名" },
              { key: "delete", icon: Trash, label: "删除", danger: true },
            ].map((item) => (
              <button
                key={item.key}
                onClick={() => runAction(item.key as never)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-black/[0.05]",
                  item.danger ? "text-red-600" : "text-[#303030]",
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
