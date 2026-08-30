/**
 * JobsOverlay — 引擎后台任务面板（官方 ui-jobs 对齐版）
 *
 * 只读投影 ctx.jobs：任务列表 + 状态 + 耗时；打开期间 5s 轮询。
 * 引擎未暴露 jobs.list RPC 时显示说明（官方 checkout 无通用远端分发，
 * vendored mirach-patches 分支可直连）。
 */

import { useEffect } from "react";
import { useStore } from "@nanostores/react";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import {
  $engineJobs,
  $jobsAvailable,
  $jobsLoading,
  loadEngineJobs,
  type EngineJob,
  type EngineJobStatus,
} from "@/store/jobs";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<EngineJobStatus, string> = {
  running: "bg-[#F59E0B]/12 text-[#B45309]",
  stopping: "bg-[#F59E0B]/12 text-[#B45309]",
  completed: "bg-[#10B981]/12 text-[#0D9488]",
  failed: "bg-[#EF4444]/12 text-[#EF4444]",
  killed: "bg-muted text-muted-foreground",
};

const STATUS_LABEL: Record<EngineJobStatus, string> = {
  running: "运行中",
  stopping: "停止中",
  completed: "已完成",
  failed: "失败",
  killed: "已终止",
};

function duration(job: EngineJob): string {
  const end = job.finishedAt ?? Date.now();
  const ms = end - job.startedAt;
  if (ms <= 0) return "—";
  const s = ms / 1000;
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  const whole = Math.round(s);
  return `${Math.floor(whole / 60)}m${whole % 60}s`;
}

export function JobsOverlay({ onClose }: { onClose: () => void }) {
  const jobs = useStore($engineJobs);
  const available = useStore($jobsAvailable);
  const loading = useStore($jobsLoading);

  useEffect(() => {
    void loadEngineJobs();
    const timer = window.setInterval(() => void loadEngineJobs(), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  const running = jobs.filter((j) => j.status === "running" || j.status === "stopping").length;

  return (
    <OverlayShell title="引擎任务" width={760} height={560} onClose={onClose}>
      <div className="flex h-full flex-col">
        {/* 头部：运行数 + 刷新 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-black/5 px-3 py-2">
          <span className="text-xs text-muted-foreground">
            后台任务（bash / subagent 等引擎作业）· 运行中{" "}
            <span className="font-semibold tabular-nums text-[#B45309]">{running}</span> / 共{" "}
            <span className="font-semibold tabular-nums text-[#303030]">{jobs.length}</span>
          </span>
          <button
            onClick={() => void loadEngineJobs()}
            disabled={loading}
            className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-[#464646] transition-colors hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            刷新
          </button>
        </div>

        {/* 列表 */}
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {available === false ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
              <p className="text-xs font-medium text-[#303030]">引擎未暴露 jobs RPC</p>
              <p className="max-w-[420px] text-[11px] leading-relaxed text-muted-foreground">
                当前引擎没有 jobs.list 方法（官方 checkout 未内置通用远端分发）。
                使用带 mirach-patches 分支的 vendored 引擎后，此面板会自动显示真实的引擎后台任务。
              </p>
            </div>
          ) : jobs.length === 0 ? (
            <p className="py-10 text-center text-xs text-muted-foreground">
              {loading ? "加载中…" : "当前没有后台任务"}
            </p>
          ) : (
            jobs.map((job) => (
              <div key={job.id} className="border-b border-black/5 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#6366F1]/12 px-1.5 py-px text-[9px] font-semibold tracking-wide text-[#6366F1]">
                    {job.kind.toUpperCase()}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-px text-[9px] font-semibold tracking-wide",
                      STATUS_STYLE[job.status],
                    )}
                  >
                    {STATUS_LABEL[job.status]}
                  </span>
                  <span className="ml-auto shrink-0 text-[10px] tabular-nums text-muted-foreground">
                    {duration(job)}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs text-[#303030]">{job.label}</p>
                {job.detail && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{job.detail}</p>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </OverlayShell>
  );
}
