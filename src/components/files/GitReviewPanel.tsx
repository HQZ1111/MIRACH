/**
 * GitReviewPanel — Git 审查（完整操作）
 *
 * 展示工作区 Git 改动并提供完整操作：
 * 暂存/取消暂存/还原（单个与全部）、文件 diff、提交 / 推送 / 创建 PR。
 * 由顶栏下拉 → Git Review 弹窗打开（OverlayShell 包裹）。
 *
 * 状态区分：非 Tauri 环境 / 工作区不是 Git 仓库（含原因）/ 干净 / 有改动。
 * 支持运行时切换工作区（set_config 写入配置）。
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { useAppConfig } from "@/hooks/useAppConfig";
import { openPrompt } from "@/store/prompt-dialog";
import { FileDiff } from "@/components/chat/markdown/FileDiff";
import {
  ArrowClockwise,
  ArrowUp,
  CaretDown,
  Check,
  Circle,
  FolderSimple,
  GitCommit,
  UploadSimple,
  X,
} from "@phosphor-icons/react";

interface GitChange {
  path: string;
  status: string;
  /** 是否已暂存（git status 第一列） */
  staged: boolean;
}

const REVIEW_FILTERS = ["未暂存", "已暂存", "全部分支更改", "上一轮更改"];

export function GitReviewPanel() {
  const { config, reload } = useAppConfig();
  const [filter, setFilter] = useState("未暂存");
  const [filterOpen, setFilterOpen] = useState(false);
  const [inRepo, setInRepo] = useState<boolean | null>(null);
  const [changes, setChanges] = useState<GitChange[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // 选中文件的 diff（path + staged + 文本）
  const [diff, setDiff] = useState<{ path: string; staged: boolean; text: string } | null>(null);
  const [commitMsg, setCommitMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // 非 Tauri 环境提示
  const [envError, setEnvError] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    setNotice(null);
    setEnvError(null);
    try {
      const res = await invoke<{ in_repo: boolean; changes: GitChange[] }>("check_git_workspace");
      setInRepo(res.in_repo);
      setChanges(res.changes);
    } catch {
      // invoke 失败：非 Tauri 环境（浏览器调试）
      setEnvError("需要 Tauri 环境（浏览器调试下 Git 操作不可用）");
      setInRepo(false);
      setChanges([]);
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  // 切换工作区：写入配置（set_config）→ 重新加载配置 → 刷新 Git 状态
  const switchWorkspace = async () => {
    const path = await openPrompt({
      title: "切换工作区",
      label: "输入 Git 仓库目录（写入配置并刷新）",
      initialValue: config.workspace || "",
      confirmText: "切换",
    });
    if (!path || !path.trim()) return;
    try {
      await invoke("set_config", { workspace: path.trim() });
      await reload();
      await refresh();
    } catch (e) {
      setNotice(`设置工作区失败：${String(e)}`);
    }
  };

  // 查看单个文件 diff
  const showDiff = async (path: string, staged: boolean) => {
    try {
      const text = await invoke<string>("git_diff", { path, staged });
      setDiff({ path, staged, text: text || "（无差异）" });
    } catch (e) {
      setDiff({ path, staged, text: `读取 diff 失败：${String(e)}` });
    }
  };

  // 统一执行 + 刷新 + 错误提示
  const run = async (fn: () => Promise<unknown>, errPrefix: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setNotice(`${errPrefix}：${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const stage = (paths: string[]) =>
    void run(
      () => (paths.length ? invoke("git_stage", { paths }) : invoke("git_stage_all")),
      "暂存失败",
    );
  const unstage = (paths: string[]) =>
    void run(
      () => (paths.length ? invoke("git_unstage", { paths }) : invoke("git_unstage_all")),
      "取消暂存失败",
    );
  const revert = (paths: string[]) => {
    if (!window.confirm("确定还原选中改动？工作区未暂存的修改将丢失。")) return;
    void run(() => invoke("git_revert", { paths }), "还原失败");
  };
  const commit = () => {
    const msg = commitMsg.trim();
    if (!msg) return;
    void run(async () => {
      await invoke("git_commit", { message: msg });
      setCommitMsg("");
    }, "提交失败");
  };
  const push = () => void run(() => invoke("git_push"), "推送失败");
  const createPr = () => {
    const title = commitMsg.trim() || "Untitled PR";
    void run(() => invoke("git_create_pr", { title }), "创建 PR 失败");
  };

  // 按筛选显示
  const visible = changes.filter((c) => {
    if (filter === "未暂存") return !c.staged;
    if (filter === "已暂存") return c.staged;
    return true;
  });

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：筛选下拉 + 批量操作 + 刷新 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <div className="relative">
          <button
            onClick={() => setFilterOpen((v) => !v)}
            className="flex items-center gap-1 rounded-md border border-border bg-white px-2 py-1 text-body-sm text-[#303030] transition-colors hover:bg-muted"
          >
            <span>{filter}</span>
            <CaretDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {filterOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setFilterOpen(false)} />
              <div className="panel-glass menu-anim absolute left-0 top-full z-30 mt-1 w-36 rounded-xl py-1">
                {REVIEW_FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => {
                      setFilter(f);
                      setFilterOpen(false);
                    }}
                    className={cn(
                      "block w-full px-3 py-1.5 text-left text-body-sm transition-colors hover:bg-muted",
                      f === filter ? "font-medium text-[#303030]" : "text-muted-foreground",
                    )}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 批量操作 */}
        {changes.length > 0 && (
          <div className="ml-1 flex items-center gap-1">
            <button
              onClick={() => stage([])}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[11px] text-[#303030] transition-colors hover:bg-black/5 disabled:opacity-50"
            >
              全部暂存
            </button>
            <button
              onClick={() => unstage([])}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[11px] text-[#303030] transition-colors hover:bg-black/5 disabled:opacity-50"
            >
              全部取消
            </button>
            <button
              onClick={() => revert(changes.map((c) => c.path))}
              disabled={busy}
              className="rounded px-1.5 py-0.5 text-[11px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
            >
              全部还原
            </button>
          </div>
        )}

        <button
          onClick={() => void refresh()}
          title="刷新"
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
        >
          <ArrowClockwise
            className={cn("h-4 w-4", refreshing && "animate-spin")}
            weight="fill"
          />
        </button>
      </div>

      {/* 工作区行：路径 + 切换 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-1">
        <FolderSimple className="h-3 w-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={config.workspace || "未配置工作区"}>
          {config.workspace || "未配置工作区"}
        </span>
        <button
          onClick={switchWorkspace}
          className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[#303030] transition-colors hover:bg-black/5"
          title="切换 Git 仓库目录（写入 MIRACH_WORKSPACE 配置）"
        >
          切换工作区
        </button>
      </div>

      {/* 内容：改动列表 / 非 Git 仓库提示 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {envError ? (
          <p className="pt-6 text-center text-body-sm leading-relaxed text-muted-foreground">{envError}</p>
        ) : inRepo === false ? (
          <p className="pt-6 text-center text-body-sm leading-relaxed text-muted-foreground">
            当前 workspace 不在 Git 仓库中，
            <br />
            打开一个 Git 仓库目录后，
            <br />
            这里会展示当前 workspace 作用域内的改动。
          </p>
        ) : changes.length === 0 ? (
          <p className="pt-6 text-center text-body-sm text-muted-foreground">
            {inRepo === null ? "正在检测 Git 状态…" : "工作区干净，没有改动"}
          </p>
        ) : visible.length === 0 ? (
          <p className="pt-6 text-center text-body-sm text-muted-foreground">该筛选下没有改动</p>
        ) : (
          <div className="space-y-0.5">
            {visible.map((c) => (
              <div
                key={c.path}
                className={cn(
                  "group flex items-center gap-1.5 rounded-lg px-1.5 py-1 transition-colors",
                  diff?.path === c.path ? "bg-[#E9ECF5]" : "hover:bg-muted",
                )}
              >
                <button
                  onClick={() => showDiff(c.path, c.staged)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  title={c.path}
                >
                  {/* 暂存状态点 */}
                  {c.staged ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-[#10B981]" weight="bold" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0 text-[#D1D5DB]" />
                  )}
                  <span className="w-10 shrink-0 text-xs font-medium text-[#EF4444]">{c.status}</span>
                  <span className="flex-1 truncate text-body-sm text-[#303030]">{c.path}</span>
                </button>
                {/* 悬停操作：暂存/取消暂存、还原 */}
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button
                    onClick={() => (c.staged ? unstage([c.path]) : stage([c.path]))}
                    disabled={busy}
                    className="rounded px-1 py-0.5 text-[11px] text-[#303030] transition-colors hover:bg-black/5 disabled:opacity-50"
                  >
                    {c.staged ? "取消暂存" : "暂存"}
                  </button>
                  <button
                    onClick={() => revert([c.path])}
                    disabled={busy}
                    className="rounded px-1 py-0.5 text-[11px] text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    还原
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* diff 视图 */}
      {diff && (
        <div className="flex max-h-[38%] shrink-0 flex-col border-t border-border">
          <div className="flex shrink-0 items-center gap-1.5 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#303030]">
              {diff.path}
              <span className={cn("ml-1.5 rounded px-1 py-px text-[10px]", diff.staged ? "bg-[#10B981]/10 text-[#10B981]" : "bg-black/5 text-muted-foreground")}>
                {diff.staged ? "已暂存" : "未暂存"}
              </span>
            </span>
            <button
              onClick={() => setDiff(null)}
              title="关闭 diff"
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-3 pb-2">
            <FileDiff filename={diff.path} content={diff.text} />
          </div>
        </div>
      )}

      {/* 提交栏：信息输入 + 提交 / 推送 / 创建 PR */}
      <div className="shrink-0 border-t border-border px-3 py-2">
        {notice && <p className="mb-1 text-xs text-red-500">{notice}</p>}
        <input
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) commit();
          }}
          placeholder="提交信息（Enter 提交）"
          className="w-full rounded-md border border-border bg-white px-2 py-1 text-body-sm text-[#303030] outline-none transition-colors placeholder:text-muted-foreground focus:border-[#6366F1]"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          <button
            onClick={commit}
            disabled={busy || !commitMsg.trim()}
            className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <GitCommit className="h-3 w-3" />
            提交
          </button>
          <button
            onClick={push}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted disabled:opacity-50"
          >
            <ArrowUp className="h-3 w-3" />
            推送
          </button>
          <button
            onClick={createPr}
            disabled={busy}
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#303030] transition-colors hover:bg-muted disabled:opacity-50"
            title="依赖 gh CLI（推送当前分支后创建 PR）"
          >
            <UploadSimple className="h-3 w-3" />
            创建 PR
          </button>
        </div>
      </div>
    </div>
  );
}
