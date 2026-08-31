/**
 * CronOverlay — 排程面板（对齐 dsh schedule 插件语义）
 *
 * 任务列表（标题 + 状态点 + 搜索 + New cron）
 * 详情（Pause/Resume/Trigger now + Frequency/Last/Next/Deliver to + Run history）
 * 创建对话框（Name/Prompt/Frequency 预设 + Deliver to + 校验）
 *
 * 数据源：store/cron.ts —— 真实模式经 send_prompt 驱动引擎 schedule_*
 * 工具（session 内提醒：after/at/every），登记表本地持久化；不再有假种子。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  Zap,
  WifiOff,
} from "lucide-react";
import {
  $cronEngineOk,
  $cronJobs,
  $cronLoading,
  createCronJob,
  loadCronJobs,
  removeCronJob,
  togglePauseCron,
  triggerCronNow,
  type EngineCronJob,
} from "@/store/cron";
import { $engineEnv } from "@/store/engine-session";

type JobState = "enabled" | "scheduled" | "running" | "paused" | "disabled" | "error" | "completed";

const STATE_DOT: Record<JobState, string> = {
  enabled: "bg-[#303030]",
  scheduled: "bg-[#303030]",
  running: "bg-[#303030]",
  paused: "bg-[#F59E0B]",
  disabled: "bg-[#9CA3AF]",
  error: "bg-[#EF4444]",
  completed: "bg-[#9CA3AF]",
};

const STATE_PILL: Record<JobState, { label: string; cls: string }> = {
  enabled: { label: "enabled", cls: "bg-emerald-50 text-[#059669]" },
  scheduled: { label: "已排程", cls: "bg-emerald-50 text-[#059669]" },
  running: { label: "执行中", cls: "bg-emerald-50 text-[#059669]" },
  paused: { label: "已暂停", cls: "bg-amber-50 text-[#D97706]" },
  disabled: { label: "停用", cls: "bg-muted text-[#6B7280]" },
  error: { label: "错误", cls: "bg-red-50 text-[#EF4444]" },
  completed: { label: "完成", cls: "bg-muted text-[#6B7280]" },
};

const FREQUENCIES = [
  { value: "daily", label: "每天 · 上午9点", human: "每天上午 9 点提醒" },
  { value: "weekdays", label: "工作日 · 上午9点", human: "周一到周五每天上午 9 点" },
  { value: "weekly", label: "每周一 · 上午9点", human: "每周一上午 9 点" },
  { value: "monthly", label: "每月1号 · 上午9点", human: "每月 1 号上午 9 点" },
  { value: "hourly", label: "每小时", human: "每小时整点提醒一次" },
  { value: "every-15-minutes", label: "每15分钟", human: "每 15 分钟提醒一次" },
  { value: "custom", label: "自定义…", human: "" },
];

/** 自定义频率文案（dsh 提醒是自然语言规则，不是 crontab 表达式） */
const DELIVER_OPTIONS = ["本桌面对话", "执行后我来汇总"];

function jobState(j: EngineCronJob): JobState {
  const s = j.status ?? "scheduled";
  if (s === "paused" || s === "error" || s === "running" || s === "completed" || s === "disabled") {
    return s as JobState;
  }
  return j.enabled ? "scheduled" : "disabled";
}

export function CronOverlay() {
  const { t } = useI18n();
  const jobs = useStore($cronJobs);
  const engineOk = useStore($cronEngineOk);
  const loading = useStore($cronLoading);
  const engineEnvId = useStore($engineEnv).id;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [showAllEnv, setShowAllEnv] = useState(false);
  const [draft, setDraft] = useState({ name: "", prompt: "", freq: FREQUENCIES[0], deliver: DELIVER_OPTIONS[0], customCron: "" });

  // 首次挂载加载登记表（真实模式读本地持久化；mock 读演示种子）
  useEffect(() => {
    void loadCronJobs();
  }, []);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  // 环境视图（默认）：只显示当前环境的任务（名称带 "[envId] " 前缀标记）
  // 和未标记的旧任务；可切"全部环境"
  const filtered = jobs.filter((j) => {
    if (!showAllEnv) {
      const m = /^\[([^\]]+)\]/.exec(j.name);
      if (m && m[1] !== engineEnvId) return false;
    }
    return !search || j.name.toLowerCase().includes(search.toLowerCase()) || j.prompt.toLowerCase().includes(search.toLowerCase());
  });

  const submitCreate = async () => {
    if (validationError) {
      window.alert(validationError);
      return;
    }
    const f = draft.freq;
    if (f.value === "custom" && !draft.customCron.trim()) return;
    // 频率折算在 store 内完成（send_prompt → 引擎 schedule_create）
    // 环境标记：名称加 "[envId] " 前缀（排程面板按当前环境过滤显示）
    const ok = await createCronJob({
      name: draft.name.startsWith("[") ? draft.name : `[${engineEnvId}] ${draft.name}`,
      prompt: draft.prompt,
      schedule: f.value,
      deliver: draft.deliver,
    });
    if (!ok) {
      window.alert("创建失败：无法连接引擎或时间规则为空，请检查后重试。");
      return;
    }
    setCreating(false);
    setDraft({ name: "", prompt: "", freq: FREQUENCIES[0], deliver: DELIVER_OPTIONS[0], customCron: "" });
  };

  const validationError = !draft.prompt
    ? "请填写任务内容（Prompt）。"
    : draft.freq.value === "custom" && !draft.customCron.trim()
      ? "自定义频率需要填写时间描述。"
      : null;

  return (
    <div className="flex h-full">
      {/* 左列：任务列表 */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border">
        <div className="p-3 pb-2">
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("cron.search")}
              className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
            />
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          </div>
          {/* 环境视图切换：默认只看当前环境的任务（名称 "[envId] " 前缀标记） */}
          <button
            onClick={() => setShowAllEnv((v) => !v)}
            className={cn(
              "mt-1.5 w-full rounded-md border px-2 py-0.5 text-[10px] transition-colors",
              showAllEnv
                ? "border-border text-muted-foreground hover:bg-muted"
                : "border-[#6366F1]/40 bg-[#6366F1]/8 text-[#6366F1]",
            )}
          >
            {showAllEnv ? "显示：全部环境" : `显示：[${engineEnvId}] 环境`}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {filtered.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedId(j.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                selectedId === j.id ? "bg-muted" : "hover:bg-muted/60",
              )}
            >
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STATE_DOT[jobState(j)])} />
              <span className="min-w-0 flex-1 truncate text-body-sm text-[#303030]">{j.name}</span>
            </button>
          ))}
          {!loading && filtered.length === 0 && <p className="px-2 py-2 text-center text-[11px] text-muted-foreground">{t("cron.noMatches")}</p>}
        </div>
        <div className="shrink-0 border-t border-border p-2">
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New cron
          </button>
        </div>
      </div>

      {/* 右列：详情 */}
      <div className="flex min-h-0 flex-1 flex-col [scrollbar-width:none]">
        {/* 引擎语义提示（真实模式）：session 内提醒 + 经模型工具创建 */}
        {!engineOk && (
          <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-[#B45309]">
            <WifiOff className="h-3.5 w-3.5" strokeWidth={2} />
            mock 模式：仅演示数据。真实模式下任务经引擎 schedule 工具创建，随当前会话存活。
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {selected ? (
            <div className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-member font-bold text-[#303030]">{selected.name}</h3>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_PILL[jobState(selected)].cls)}>
                    {STATE_PILL[jobState(selected)].label}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void togglePauseCron(selected.id)}
                    title={selected.status === "paused" ? "Resume" : "Pause"}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[#464646] transition-colors hover:bg-muted"
                  >
                    {selected.status === "paused" ? (
                      <Play className="h-4 w-4" strokeWidth={2} />
                    ) : (
                      <Pause className="h-4 w-4" strokeWidth={2} />
                    )}
                  </button>
                  <button
                    onClick={() => void triggerCronNow(selected.id)}
                    className="flex items-center gap-1 rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#464646]"
                  >
                    <Zap className="h-3 w-3" strokeWidth={2} />
                    {t("cron.triggerNow")}
                  </button>
                  <button
                    onClick={() => void removeCronJob(selected.id)}
                    title={t("cron.delete")}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[#EF4444] transition-colors hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg border border-border bg-muted/20 p-3 text-body-sm">
                <MetaRow label="频率规则" value={selected.schedule || "—"} />
                <MetaRow label="创建时间" value={new Date(selected.createdAt).toLocaleString()} />
                <MetaRow label="送达方式" value={selected.deliver || "—"} />
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("cron.prompt")}</p>
                <div className="mt-1.5 rounded-lg border border-border bg-muted/20 p-3 font-mono text-[12px] leading-relaxed text-[#303030]">
                  {selected.prompt || "—"}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">下发的排程指令</p>
                <div className="mt-1.5 rounded-lg border border-border/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                  {selected.instruction || "—"}
                  {!engineOk && selected.instruction ? "" : "（发送后由模型在当前会话调用 schedule_create 落地）"}
                </div>
              </div>
            </div>
          ) : (
            <p className="p-5 text-body-sm text-muted-foreground">{t("cron.selectOrCreate")}</p>
          )}
        </div>
      </div>

      {/* 创建对话框 */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-md">
          <div className="absolute inset-0" onClick={() => setCreating(false)} />
          <div className="panel-glass popup-anim relative w-[480px] rounded-2xl p-5">
            <h3 className="text-member font-bold text-[#303030]">{t("cron.newCronJob")}</h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t("cron.newCronDesc")} like "every 15 minutes".
            </p>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">
                  Name <span className="font-normal">(Optional)</span>
                </label>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  placeholder="Morning briefing"
                  className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">{t("cron.prompt")}</label>
                <textarea
                  value={draft.prompt}
                  onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))}
                  placeholder="Summarize my unread Slack threads and email me the top 5..."
                  rows={3}
                  className="mt-1 w-full rounded-md border border-border px-2.5 py-1.5 font-mono text-[12px] text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">{t("cron.frequency")}</label>
                <select
                  value={draft.freq.label}
                  onChange={(e) => {
                    const f = FREQUENCIES.find((x) => x.label === e.target.value) ?? FREQUENCIES[0];
                    setDraft((d) => ({ ...d, freq: f }));
                  }}
                  className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] focus:outline-none"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.value}>{f.label}</option>
                  ))}
                </select>
                {draft.freq.value !== "custom" ? (
                  <div className="mt-1.5 flex items-center justify-between rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5">
                    <span className="text-[11px] text-[#303030]">{draft.freq.human}</span>
                  </div>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    <input
                      value={draft.customCron}
                      onChange={(e) => setDraft((d) => ({ ...d, customCron: e.target.value }))}
                      placeholder="例如：每天晚上 8 点 / 每工作日下午 3 点半"
                      className="w-full rounded-md border border-border px-2.5 py-1.5 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none"
                    />
                    <p className="text-[11px] text-muted-foreground">用自然语言描述时间规则，模型会折算成引擎的 after/at/every 提醒。</p>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground">{t("cron.deliverTo")}</label>
                <select
                  value={draft.deliver}
                  onChange={(e) => setDraft((d) => ({ ...d, deliver: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border bg-white px-2.5 py-1.5 text-body-sm text-[#303030] focus:outline-none"
                >
                  {DELIVER_OPTIONS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </select>
              </div>
              {validationError && (
                <p className="rounded-md bg-red-50 px-2.5 py-1.5 text-[11px] text-[#EF4444]">{validationError}</p>
              )}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-[#464646] transition-colors hover:bg-muted"
              >
                Cancel
              </button>
              <button
                onClick={() => void submitCreate()}
                className="rounded-md bg-[#303030] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#464646]"
              >
                Create cron
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-[#303030]">{value}</span>
    </div>
  );
}
