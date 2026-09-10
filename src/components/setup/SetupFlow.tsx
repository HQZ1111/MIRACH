/**
 * SetupFlow — 首次启动安装门（照搬 hermes apps/bootstrap-installer 的流程）
 *
 * 首次打开、本地运行时缺失时全屏接管：
 *   选择页（本地安装 / 连接远端引擎）→ 进度页（阶段列表 + 实时日志 + 取消）
 *   → 成功页（进入应用） / 失败页（重试）。
 *
 * 状态全部来自 `@/store/bootstrap`（Rust `bootstrap` 事件通道），组件只做展示。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ChevronRight,
  CircleAlert,
  Cloud,
  HardDriveDownload,
  Loader2,
  Minus,
} from "lucide-react";
import {
  $bootstrap,
  $progress,
  $route,
  $status,
  cancelInstall,
  closeSetup,
  finishSetup,
  refreshStatus,
  retryInstall,
  startInstall,
  type StageRecord,
} from "@/store/bootstrap";

const INPUT =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-body-sm text-[#303030] outline-none transition-colors placeholder:text-muted-foreground focus:border-[#017CF3]";

/** 运行中阶段的行内计时（每秒 tick）。 */
function useTicker(active: boolean): number {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setN((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [active]);
  return Date.now();
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

function StageRow({ rec, now }: { rec: StageRecord; now: number }) {
  const { info, state, durationMs, startedAt, error } = rec;
  const elapsed =
    state === "running" && startedAt
      ? fmtDuration(now - startedAt)
      : durationMs !== undefined
        ? fmtDuration(durationMs)
        : "";

  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
        {state === "running" && <Loader2 className="h-4 w-4 animate-spin text-[#017CF3]" />}
        {state === "succeeded" && <Check className="h-4 w-4 text-[#16A34A]" strokeWidth={2.5} />}
        {state === "skipped" && <Minus className="h-4 w-4 text-muted-foreground" />}
        {state === "failed" && <CircleAlert className="h-4 w-4 text-[#EF4444]" />}
        {state === null && <span className="h-1.5 w-1.5 rounded-full bg-[#D4D4D4]" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={
              state === "running"
                ? "text-body-sm font-medium text-[#303030]"
                : state === null
                  ? "text-body-sm text-muted-foreground"
                  : "text-body-sm text-[#303030]"
            }
          >
            {info.title}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
            {state === "skipped" ? "已跳过" : elapsed}
          </span>
        </div>
        {state === "failed" && error && <p className="mt-0.5 break-all text-[11px] text-[#EF4444]">{error}</p>}
        {state === "skipped" && error && <p className="mt-0.5 text-[11px] text-muted-foreground">{error}</p>}
      </div>
    </div>
  );
}

function Card({
  icon,
  title,
  desc,
  badge,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="group flex w-full items-start gap-3 rounded-xl border border-border bg-white p-4 text-left transition-all hover:border-[#017CF3] hover:shadow-[0_2px_12px_rgba(1,124,243,0.08)]"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F5F5F5] text-[#303030] transition-colors group-hover:bg-[#E8F3FE] group-hover:text-[#017CF3]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="text-member font-semibold text-[#303030]">{title}</span>
          {badge && (
            <span className="rounded-full bg-[#E8F3FE] px-1.5 py-0.5 text-[10px] font-medium text-[#017CF3]">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block text-body-sm leading-relaxed text-muted-foreground">{desc}</span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#C4C4C4] transition-transform group-hover:translate-x-0.5 group-hover:text-[#017CF3]" />
    </button>
  );
}

/** 选择页：本地安装 / 连接远端引擎 */
function ChoiceScreen() {
  const status = useStore($status);
  const [busy, setBusy] = useState(false);

  const install = async () => {
    setBusy(true);
    try {
      await startInstall();
    } finally {
      setBusy(false);
    }
  };

  const missing = status?.missing ?? [];
  const missingLabel = missing
    .map((m) => ({ node: "Node 运行时", deps: "引擎依赖", sidecar: "桥接程序" })[m] ?? m)
    .join("、");

  return (
    <div className="w-[520px] max-w-[92vw]">
      <div className="mb-6 text-center">
        <div className="text-[26px] font-bold tracking-tight text-[#303030]">Mirach</div>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {missingLabel ? `首次使用：还缺 ${missingLabel}` : "首次使用：准备运行环境"}
        </p>
      </div>

      <div className="space-y-3">
        <Card
          icon={<HardDriveDownload className="h-4 w-4" />}
          title="本地安装"
          badge="推荐"
          desc="在这台电脑上下载运行环境（Node + 引擎 + 桥接程序，约 200–300MB）。安装过程有进度，完成后直接使用。"
          onClick={() => void install()}
        />
        <Card
          icon={<Cloud className="h-4 w-4" />}
          title="连接远端引擎"
          desc="引擎跑在另一台机器（SSH 可达），本机只做界面。适合服务器/云主机已装好环境的场景。"
          onClick={() => $route.set("remote")}
        />
      </div>

      {busy && (
        <p className="mt-4 flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> 正在启动安装…
        </p>
      )}
      {status?.installRoot && (
        <p className="mt-5 break-all text-center text-[11px] text-muted-foreground">
          安装目录：{status.installRoot}
        </p>
      )}
    </div>
  );
}

/** 远端引擎配置页（复用 Rust 的 ssh_test / dsh_restart_sidecar） */
function RemoteScreen() {
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [test, setTest] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    void invoke<Record<string, unknown>>("get_config")
      .then(setCfg)
      .catch(() => {});
  }, []);

  const save = (patch: Record<string, unknown>): void => {
    setCfg((c) => ({ ...c, ...patch }));
    void invoke("set_config", { patch }).catch(() => {});
  };
  const s = (k: string): string => (typeof cfg[k] === "string" ? (cfg[k] as string) : "");

  const runTest = async (): Promise<void> => {
    setTesting(true);
    setTest(null);
    try {
      const out = await invoke<string>("ssh_test", {
        host: s("remoteHost"),
        port: s("remotePort"),
        identity: s("remoteIdentity"),
        node: s("remoteNode") || "node",
        sidecar: s("remoteSidecar"),
      });
      setTest({ ok: true, msg: out || "连接成功" });
    } catch (e) {
      setTest({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const connect = async (): Promise<void> => {
    setConnecting(true);
    try {
      save({ remoteEnabled: true });
      await invoke("dsh_restart_sidecar").catch(() => {});
      await refreshStatus();
      // 远端是否真的可用由主界面的引擎连接状态呈现，这里直接放行进应用
      closeSetup();
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="w-[520px] max-w-[92vw]">
      <div className="mb-5">
        <h2 className="text-subheading font-bold text-[#303030]">连接远端引擎</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          本机通过 SSH 启动远端的 node + Mirach 桥接程序。远端需已安装 Node 22+ 与桥接程序。
        </p>
      </div>

      <div className="space-y-2.5">
        <input
          className={INPUT}
          placeholder="user@host（如 root@10.0.0.5）"
          value={s("remoteHost")}
          onChange={(e) => setCfg((c) => ({ ...c, remoteHost: e.target.value }))}
          onBlur={(e) => save({ remoteHost: e.target.value.trim() })}
        />
        <div className="grid grid-cols-2 gap-2.5">
          <input
            className={INPUT}
            placeholder="端口（默认 22）"
            value={s("remotePort")}
            onChange={(e) => setCfg((c) => ({ ...c, remotePort: e.target.value }))}
            onBlur={(e) => save({ remotePort: e.target.value.trim() })}
          />
          <input
            className={INPUT}
            placeholder="远端 node（默认 node）"
            value={s("remoteNode")}
            onChange={(e) => setCfg((c) => ({ ...c, remoteNode: e.target.value }))}
            onBlur={(e) => save({ remoteNode: e.target.value.trim() || "node" })}
          />
        </div>
        <input
          className={INPUT}
          placeholder="SSH 私钥路径（可选，等同 ssh -i）"
          value={s("remoteIdentity")}
          onChange={(e) => setCfg((c) => ({ ...c, remoteIdentity: e.target.value }))}
          onBlur={(e) => save({ remoteIdentity: e.target.value.trim() })}
        />
        <input
          className={INPUT}
          placeholder="远端桥接入口（如 /opt/mirach/agent-sidecar/dist/index.js）"
          value={s("remoteSidecar")}
          onChange={(e) => setCfg((c) => ({ ...c, remoteSidecar: e.target.value }))}
          onBlur={(e) => save({ remoteSidecar: e.target.value.trim() })}
        />
      </div>

      {test && (
        <p className={`mt-3 break-all text-[11px] ${test.ok ? "text-[#16A34A]" : "text-[#EF4444]"}`}>
          {test.msg}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <button
          onClick={() => void runTest()}
          disabled={testing || !s("remoteHost")}
          className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-body-sm font-medium text-[#303030] transition-colors hover:bg-muted disabled:opacity-50"
        >
          {testing ? "测试中…" : "测试连接"}
        </button>
        <button
          onClick={() => void connect()}
          disabled={connecting || !s("remoteHost")}
          className="flex-1 rounded-lg bg-[#017CF3] px-3 py-2 text-body-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {connecting ? "连接中…" : "保存并连接"}
        </button>
      </div>
      <button
        onClick={() => $route.set("choice")}
        className="mt-3 w-full text-center text-[11px] text-muted-foreground hover:text-[#303030]"
      >
        返回上一步
      </button>
    </div>
  );
}

/** 进度页：阶段列表 + 进度条 + 可折叠日志 + 取消 */
function ProgressScreen() {
  const b = useStore($bootstrap);
  const p = useStore($progress);
  const [showLog, setShowLog] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const now = useTicker(b.status === "running");

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [showLog, b.logs.length]);

  const title = b.status === "failed" ? "安装中断" : "正在准备运行环境";

  return (
    <div className="w-[560px] max-w-[94vw]">
      <div className="mb-4">
        <h2 className="text-subheading font-bold text-[#303030]">{title}</h2>
        <p className="mt-1 text-body-sm text-muted-foreground">
          {p.total > 0 ? `${p.done}/${p.total} 个步骤` : "正在读取安装清单…"}
          {b.currentStage && b.stages[b.currentStage]
            ? ` · 当前：${b.stages[b.currentStage].info.title}`
            : ""}
        </p>
      </div>

      <div className="h-1 w-full overflow-hidden rounded-full bg-[#EEEEEE]">
        <div
          className="h-full rounded-full bg-[#017CF3] transition-[width] duration-500"
          style={{ width: `${Math.round(p.fraction * 100)}%` }}
        />
      </div>

      <div className="mt-3 max-h-[300px] divide-y divide-[#F0F0F0] overflow-y-auto rounded-xl border border-border bg-white px-4 py-1">
        {b.stageOrder.map((name) => (
          <StageRow key={name} rec={b.stages[name]} now={now} />
        ))}
        {b.stageOrder.length === 0 && (
          <div className="flex items-center gap-2 py-4 text-body-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在启动安装器…
          </div>
        )}
      </div>

      <div className="mt-3">
        <button
          onClick={() => setShowLog((v) => !v)}
          className="text-[11px] font-medium text-[#017CF3] hover:underline"
        >
          {showLog ? "收起日志" : `查看日志（${b.logs.length} 行）`}
        </button>
        {showLog && (
          <div
            ref={logRef}
            className="mt-2 h-[180px] overflow-y-auto rounded-xl border border-border bg-[#FAFAFA] p-3 font-mono text-[11px] leading-relaxed text-[#464646]"
          >
            {b.logs.map((l, i) => (
              <div key={i} className={l.stream === "stderr" ? "text-[#B45309]" : undefined}>
                {l.stage ? `[${l.stage}] ` : ""}
                {l.line}
              </div>
            ))}
            {b.logs.length === 0 && <span className="text-muted-foreground">（暂无输出）</span>}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <span className="text-[11px] text-muted-foreground">
          安装到 {b.installRoot ?? "$LOCALAPPDATA\\MirachRuntime"}；可随时取消，已下载内容会保留。
        </span>
        <button
          onClick={() => void cancelInstall().then(() => $route.set("failure"))}
          className="shrink-0 rounded-lg border border-border bg-white px-3 py-1.5 text-body-sm font-medium text-[#303030] transition-colors hover:bg-muted"
        >
          取消
        </button>
      </div>
    </div>
  );
}

/** 成功页 */
function SuccessScreen() {
  const b = useStore($bootstrap);
  const [busy, setBusy] = useState(false);

  const enter = async (): Promise<void> => {
    setBusy(true);
    try {
      await finishSetup();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-[460px] max-w-[92vw] text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#E8F7EE]">
        <Check className="h-6 w-6 text-[#16A34A]" strokeWidth={2.5} />
      </span>
      <h2 className="mt-4 text-subheading font-bold text-[#303030]">安装完成</h2>
      <p className="mt-1.5 text-body-sm leading-relaxed text-muted-foreground">
        运行环境已就绪，现在可以开始使用 Mirach。
      </p>
      {b.installRoot && (
        <p className="mt-2 break-all text-[11px] text-muted-foreground">{b.installRoot}</p>
      )}
      <button
        onClick={() => void enter()}
        disabled={busy}
        className="mt-6 w-full rounded-lg bg-[#017CF3] px-4 py-2.5 text-body-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {busy ? "正在启动引擎…" : "进入 Mirach"}
      </button>
    </div>
  );
}

/** 失败页 */
function FailureScreen() {
  const b = useStore($bootstrap);
  const [showLog, setShowLog] = useState(false);
  const [busy, setBusy] = useState(false);

  const retry = async (): Promise<void> => {
    setBusy(true);
    try {
      await retryInstall();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-[520px] max-w-[94vw]">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#FDECEC]">
          <CircleAlert className="h-5 w-5 text-[#EF4444]" />
        </span>
        <div className="min-w-0">
          <h2 className="text-subheading font-bold text-[#303030]">安装未完成</h2>
          <p className="mt-1 break-all text-body-sm leading-relaxed text-muted-foreground">
            {b.error ?? "安装过程出错，可重试或改用远端引擎。"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => void retry()}
          disabled={busy}
          className="flex-1 rounded-lg bg-[#017CF3] px-3 py-2 text-body-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "重试中…" : "重试安装"}
        </button>
        <button
          onClick={() => $route.set("remote")}
          className="flex-1 rounded-lg border border-border bg-white px-3 py-2 text-body-sm font-medium text-[#303030] transition-colors hover:bg-muted"
        >
          改用远端引擎
        </button>
      </div>

      {b.logs.length > 0 && (
        <>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="mt-4 text-[11px] font-medium text-[#017CF3] hover:underline"
          >
            {showLog ? "收起日志" : `查看日志（${b.logs.length} 行）`}
          </button>
          {showLog && (
            <div className="mt-2 h-[200px] overflow-y-auto rounded-xl border border-border bg-[#FAFAFA] p-3 font-mono text-[11px] leading-relaxed text-[#464646]">
              {b.logs.slice(-500).map((l, i) => (
                <div key={i} className={l.stream === "stderr" ? "text-[#B45309]" : undefined}>
                  {l.stage ? `[${l.stage}] ` : ""}
                  {l.line}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function SetupFlow() {
  const route = useStore($route);
  const body = useMemo(() => {
    switch (route) {
      case "progress":
        return <ProgressScreen />;
      case "success":
        return <SuccessScreen />;
      case "failure":
        return <FailureScreen />;
      case "remote":
        return <RemoteScreen />;
      default:
        return <ChoiceScreen />;
    }
  }, [route]);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[#F7F8FA]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-gradient-to-b from-[#EAF4FE] to-transparent" />
      <div className="panel-glass popup-anim relative rounded-2xl p-8 shadow-[0_8px_40px_rgba(0,0,0,0.06)]">
        {body}
      </div>
    </div>
  );
}
