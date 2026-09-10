/**
 * store/bootstrap — 首次启动依赖安装的状态机
 *
 * 设计照搬 hermes `apps/bootstrap-installer/src/store.ts`：Rust 侧经 `bootstrap`
 * 事件通道推送 manifest/stage/log/complete/failed，这里翻译成纳米存储，供安装
 * 界面消费（nanostores 是两端共同的状态方案）。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { atom, computed } from "nanostores";

export interface StageInfo {
  name: string;
  title: string;
  category: string;
  needs_user_input?: boolean;
}

export type StageState = "running" | "succeeded" | "skipped" | "failed";

export interface StageRecord {
  info: StageInfo;
  state: StageState | null;
  durationMs?: number;
  /** 进入 running 的本地时间戳（UI 用来走实时计时） */
  startedAt?: number;
  error?: string;
}

export interface BootstrapStateModel {
  status: "idle" | "running" | "completed" | "failed";
  protocolVersion: number | null;
  stages: Record<string, StageRecord>;
  stageOrder: string[];
  currentStage: string | null;
  installRoot: string | null;
  error: string | null;
  logs: Array<{ stage?: string; line: string; stream?: "stdout" | "stderr" }>;
}

const INITIAL: BootstrapStateModel = {
  status: "idle",
  protocolVersion: null,
  stages: {},
  stageOrder: [],
  currentStage: null,
  installRoot: null,
  error: null,
  logs: [],
};

/** 首次启动的三种去向：本地装依赖 / 连远端引擎 / 直接进入（运行时已就绪）。 */
export type SetupRoute = "choice" | "progress" | "success" | "failure" | "remote";

export interface BootstrapStatus {
  ready: boolean;
  installRoot: string;
  missing: string[];
  marker: unknown;
  /** 当前应用版本（Rust 侧 CARGO_PKG_VERSION） */
  appVersion?: string;
  /** 运行时是旧版应用装的（应用升级过）→ 静默重跑轻量阶段刷新 sidecar 代码 */
  stale?: boolean;
}

export const $route = atom<SetupRoute>("choice");
export const $bootstrap = atom<BootstrapStateModel>(INITIAL);
export const $status = atom<BootstrapStatus | null>(null);
/** 安装门是否显示（运行时缺失时全屏接管；状态未知/就绪时不挡）。 */
export const $setupOpen = atom(false);

export function closeSetup(): void {
  $setupOpen.set(false);
}

export const $progress = computed($bootstrap, (b) => {
  const total = b.stageOrder.length;
  if (total === 0) return { done: 0, total: 0, fraction: 0 };
  let done = 0;
  for (const name of b.stageOrder) {
    const s = b.stages[name]?.state;
    if (s === "succeeded" || s === "skipped" || s === "failed") done += 1;
  }
  return { done, total, fraction: done / total };
});

function withStageState(
  cur: BootstrapStateModel,
  name: string,
  state: StageState,
  durationMs?: number,
  error?: string,
): BootstrapStateModel {
  const existing = cur.stages[name];
  if (!existing) return cur;
  return {
    ...cur,
    stages: {
      ...cur.stages,
      [name]: {
        ...existing,
        state,
        startedAt: state === "running" ? (existing.startedAt ?? Date.now()) : existing.startedAt,
        durationMs,
        error,
      },
    },
    currentStage: state === "running" ? name : cur.currentStage,
  };
}

interface BootstrapEventPayload {
  type: "manifest" | "stage" | "log" | "complete" | "failed";
  stages?: StageInfo[];
  protocolVersion?: number | null;
  name?: string;
  state?: StageState;
  durationMs?: number;
  stage?: string;
  line?: string;
  stream?: "stdout" | "stderr";
  installRoot?: string;
  error?: string;
}

let unlisten: UnlistenFn | null = null;

/** 订阅安装事件（幂等；应用启动时调用一次）。 */
export async function initBootstrap(): Promise<void> {
  if (unlisten) return;
  const s = await refreshStatus();
  // 运行时缺失 → 全屏安装门；读取失败（非 Tauri 环境）不挡
  if (s) $setupOpen.set(!s.ready);
  // 应用升级过：后台重跑一遍阶段（node/deps 会跳过，只刷新 sidecar 代码 + 标记）
  if (s && s.ready && s.stale) void refreshRuntime();
  unlisten = await listen<BootstrapEventPayload>("bootstrap", (event) => {
    const p = event.payload;
    const cur = $bootstrap.get();
    switch (p.type) {
      case "manifest": {
        const stages: Record<string, StageRecord> = {};
        const order: string[] = [];
        for (const s of p.stages ?? []) {
          stages[s.name] = { info: s, state: null };
          order.push(s.name);
        }
        $bootstrap.set({
          ...cur,
          status: "running",
          protocolVersion: p.protocolVersion ?? null,
          stages,
          stageOrder: order,
          currentStage: null,
          installRoot: null,
          error: null,
          logs: [],
        });
        $route.set("progress");
        break;
      }
      case "stage": {
        if (p.name === undefined || !cur.stages[p.name]) break;
        $bootstrap.set(withStageState(cur, p.name, p.state ?? "running", p.durationMs, p.error));
        break;
      }
      case "log": {
        const logs = [...cur.logs, { stage: p.stage, line: p.line ?? "", stream: p.stream }];
        // 环形上限：长安装（npm 大量输出）不能把 UI 撑爆
        $bootstrap.set({ ...cur, logs: logs.length > 2000 ? logs.slice(-2000) : logs });
        break;
      }
      case "complete":
        $bootstrap.set({ ...cur, status: "completed", installRoot: p.installRoot ?? null, currentStage: null });
        void refreshStatus();
        $route.set("success");
        break;      case "failed":
        $bootstrap.set({ ...cur, status: "failed", error: p.error ?? "安装失败", currentStage: null });
        $route.set("failure");
        break;
    }
  });
}

/** 重新读取安装状态（启动门/成功页用）。 */
export async function refreshStatus(): Promise<BootstrapStatus | null> {
  try {
    const s = await invoke<BootstrapStatus>("bootstrap_status");
    $status.set(s);
    return s;
  } catch {
    return null;
  }
}

export async function startInstall(): Promise<void> {
  $bootstrap.set(INITIAL);
  $route.set("progress");
  await invoke("bootstrap_start");
}

export async function cancelInstall(): Promise<void> {
  await invoke("bootstrap_cancel");
}

/** 失败后重试：清标记与缓存再装。 */
export async function retryInstall(): Promise<void> {
  await invoke("bootstrap_reset").catch(() => {});
  await startInstall();
}

/** 安装完成后进入应用（Rust 侧按新运行时重启 sidecar）。 */
export async function finishSetup(): Promise<void> {
  await invoke("dsh_restart_sidecar").catch(() => {});
  await refreshStatus();
  closeSetup();
}

/**
 * 运行时刷新（应用升级后用）：后台跑一遍阶段（已就绪的部分会跳过），
 * 完成后重启 sidecar 让新代码生效。不弹安装门、不打断当前界面。
 */
async function refreshRuntime(): Promise<void> {
  try {
    await invoke("bootstrap_start");
    await invoke("dsh_restart_sidecar").catch(() => {});
  } catch {
    /* 失败保持旧运行时可用，不打扰用户 */
  }
  await refreshStatus();
}
