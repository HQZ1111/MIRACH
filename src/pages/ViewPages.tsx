/**
 * ViewPages — 左工具栏视图专属页（轻量占位，接后端后替换为真实数据）
 *
 * chat 保持主聊天；code/work/finance/write/bookmarks/knowledge 各一个轻页面：
 * - code       复用文件查看器（真实文件浏览）
 * - work       本地任务清单（localStorage）
 * - write      Markdown 编辑 + 预览
 * - bookmarks  本地收藏列表（localStorage）
 * - finance / knowledge  占位 + 复用现有能力入口
 */

import { useState } from "react";
import { FileViewerPanel } from "@/components/files/FileViewerPanel";
import { MarkdownText } from "@/components/chat/markdown/MarkdownText";
import { StarmapView } from "@/components/starmap/StarmapView";
import { getPluginViewPage } from "@/plugins/registry";
import { cn } from "@/lib/utils";

export function ViewPage({ view }: { view: string }) {
  switch (view) {
    case "code":
      return <FileViewerPanel />;
    case "work":
      return <WorkPage />;
    case "finance":
      return <FinancePage />;
    case "write":
      return <WritePage />;
    case "bookmarks":
      return <BookmarksPage />;
    case "knowledge":
      return <StarmapView />;
    default: {
      // 插件扩展路由：注册表 viewPage 贡献点按 view id 解析
      const page = getPluginViewPage(view);
      return page ? page.render() : null;
    }
  }
}

// ---- Work：本地任务清单 ----

interface Task {
  id: number;
  text: string;
  done: boolean;
}

const WORK_KEY = "mirach.workTasks.v1";

function loadTasks(): Task[] {
  try {
    const raw = localStorage.getItem(WORK_KEY);
    if (raw) return JSON.parse(raw) as Task[];
  } catch {
    /* ignore */
  }
  return [
    { id: 1, text: "整理本周周报", done: false },
    { id: 2, text: "评审 PR #42", done: true },
  ];
}

function WorkPage() {
  const [tasks, setTasks] = useState<Task[]>(loadTasks);
  const [text, setText] = useState("");
  const persist = (list: Task[]) => {
    try {
      localStorage.setItem(WORK_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    setTasks(list);
  };
  const add = () => {
    if (!text.trim()) return;
    persist([{ id: Date.now(), text: text.trim(), done: false }, ...tasks]);
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <p className="text-body-sm font-medium text-[#303030]">任务清单（本地演示）</p>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="新任务…（Enter 添加）"
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
        />
        <button
          onClick={add}
          className="shrink-0 rounded-md bg-[#303030] px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          添加
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {tasks.map((t) => (
          <label key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
            <input
              type="checkbox"
              checked={t.done}
              onChange={() => persist(tasks.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
              className="h-3.5 w-3.5"
            />
            <span className={cn("flex-1 text-body-sm", t.done ? "text-muted-foreground line-through" : "text-[#303030]")}>
              {t.text}
            </span>
            <button
              onClick={() => persist(tasks.filter((x) => x.id !== t.id))}
              className="text-[11px] text-muted-foreground transition-colors hover:text-[#EF4444]"
            >
              删除
            </button>
          </label>
        ))}
        {tasks.length === 0 && <p className="pt-6 text-center text-body-sm text-muted-foreground">暂无任务</p>}
      </div>
    </div>
  );
}

// ---- Finance：占位 ----

function FinancePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-member font-medium text-[#303030]">金融视图</p>
      <p className="max-w-sm text-body-sm text-muted-foreground">
        占位页。接后端后这里展示行情/资产/报告等金融数据。
      </p>
    </div>
  );
}

// ---- Write：Markdown 编辑 + 预览 ----

function WritePage() {
  const [md, setMd] = useState("# 新文档\n\n在这里开始写作…\n\n- 支持 **Markdown**、`代码`、`$$\\sum$$` 公式");
  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <p className="text-body-sm font-medium text-[#303030]">写作（Markdown 编辑 + 预览）</p>
      <div className="mt-2 grid min-h-0 flex-1 grid-cols-2 gap-3">
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          className="h-full w-full resize-none rounded-lg border border-border bg-white p-3 font-mono text-[13px] leading-relaxed text-[#303030] outline-none focus:border-[#6366F1]"
        />
        <div className="h-full overflow-auto rounded-lg border border-border bg-white p-3">
          <MarkdownText content={md} />
        </div>
      </div>
    </div>
  );
}

// ---- Bookmarks：本地收藏 ----

const BOOK_KEY = "mirach.bookmarks.v1";

function BookmarksPage() {
  const [items, setItems] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(BOOK_KEY);
      return raw ? (JSON.parse(raw) as string[]) : ["https://github.com", "https://tauri.app"];
    } catch {
      return ["https://github.com"];
    }
  });
  const [url, setUrl] = useState("");
  const persist = (list: string[]) => {
    try {
      localStorage.setItem(BOOK_KEY, JSON.stringify(list));
    } catch {
      /* ignore */
    }
    setItems(list);
  };
  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <p className="text-body-sm font-medium text-[#303030]">收藏（本地演示）</p>
      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && url.trim()) {
              persist([url.trim(), ...items]);
              setUrl("");
            }
          }}
          placeholder="添加收藏链接…（Enter）"
          className="min-w-0 flex-1 rounded-md border border-border bg-white px-2 py-1.5 text-body-sm text-[#303030] outline-none placeholder:text-muted-foreground focus:border-[#6366F1]"
        />
      </div>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {items.map((u, i) => (
          <div key={i} className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60">
            <a
              href={u}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 flex-1 truncate text-body-sm text-[#6366F1] hover:underline"
            >
              {u}
            </a>
            <button
              onClick={() => persist(items.filter((_, j) => j !== i))}
              className="text-[11px] text-muted-foreground transition-colors hover:text-[#EF4444]"
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
