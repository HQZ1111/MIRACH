/**
 * jobs — 引擎后台任务 store（官方 jobs-local 注册表的只读投影）
 *
 * 数据源：引擎 ctx.jobs（LocalJobRegistry，kind=bash/subagent/…）。
 * 面板只读，对齐官方 ui-jobs 语义（启停由引擎工具自身负责，面板不操作）。
 * RPC：jobs.list 经 sidecar 通用 rpc 透传到运行时——vendored 引擎
 * （mirach-patches 分支）的通用远端分发可直连；官方 checkout 未暴露该方法，
 * 调用失败即 available=false（面板给出说明，不灌假数据）。
 */

import { atom } from "nanostores";
import { MOCK } from "@/lib/mock";
import { invoke } from "@tauri-apps/api/core";

/** 官方 JobStatus（packages/jobs/jobs/src/types.ts） */
export type EngineJobStatus = "running" | "stopping" | "completed" | "killed" | "failed";

export interface EngineJob {
  id: string;
  kind: string;
  label: string;
  status: EngineJobStatus;
  detail?: string;
  ownerSession?: string;
  startedAt: number;
  finishedAt?: number;
}

export const $engineJobs = atom<EngineJob[]>([]);
/** undefined=未探测 / true=RPC 可用 / false=引擎未暴露 jobs.list */
export const $jobsAvailable = atom<boolean | undefined>(undefined);
export const $jobsLoading = atom(false);

interface RawJobSnapshot {
  id?: unknown;
  kind?: unknown;
  label?: unknown;
  status?: unknown;
  detail?: unknown;
  ownerSession?: unknown;
  startedAt?: unknown;
  finishedAt?: unknown;
}

function normalize(raw: RawJobSnapshot): EngineJob | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.label !== "string") return null;
  const status = raw.status;
  return {
    id: raw.id,
    kind: typeof raw.kind === "string" ? raw.kind : "job",
    label: raw.label,
    status:
      status === "running" || status === "stopping" || status === "completed"
      || status === "killed" || status === "failed"
        ? status
        : "completed",
    ...(typeof raw.detail === "string" && raw.detail ? { detail: raw.detail } : {}),
    ...(typeof raw.ownerSession === "string" ? { ownerSession: raw.ownerSession } : {}),
    startedAt: typeof raw.startedAt === "number" ? raw.startedAt : 0,
    ...(typeof raw.finishedAt === "number" ? { finishedAt: raw.finishedAt } : {}),
  };
}

/**
 * 拉取引擎任务列表（jobs.list → ctx.jobs.list()）。
 * 返回 RPC 是否可用；失败时 available=false 并清空列表。
 */
export async function loadEngineJobs(): Promise<boolean> {
  if (MOCK) {
    // mock：演示两条（一条运行中），面板可看布局
    $engineJobs.set([
      { id: "bash-1", kind: "bash", label: "npm run build（演示）", status: "running", startedAt: Date.now() - 42_000 },
      { id: "subagent-1", kind: "subagent", label: "代码审查（演示）", status: "completed", detail: "exit code: 0", startedAt: Date.now() - 300_000, finishedAt: Date.now() - 120_000 },
    ]);
    $jobsAvailable.set(true);
    return true;
  }
  $jobsLoading.set(true);
  try {
    const raw = await invoke<unknown>("relay_rpc", { method: "jobs.list", params: null });
    // sidecar rpc 信封：{result: <payload>}；payload 可能是数组或 {jobs: [...]}
    const payload = (raw as { result?: unknown } | null)?.result ?? raw;
    const list = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { jobs?: unknown[] } | null)?.jobs)
        ? (payload as { jobs: unknown[] }).jobs
        : [];
    $engineJobs.set(list.map((j) => normalize(j as RawJobSnapshot)).filter((j): j is EngineJob => j !== null));
    $jobsAvailable.set(true);
    return true;
  } catch {
    // 引擎未暴露 jobs.list（官方 checkout 无通用远端分发）或运行时不可达
    $engineJobs.set([]);
    $jobsAvailable.set(false);
    return false;
  } finally {
    $jobsLoading.set(false);
  }
}
