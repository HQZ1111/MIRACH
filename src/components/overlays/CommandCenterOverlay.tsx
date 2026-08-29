/**
 * CommandCenterOverlay — 命令中心面板（按原型 Command Center 精确复刻）
 *
 * 4 节导航：Sessions / System / Usage / Maintenance
 * - Sessions：会话列表（标题+时间戳，hover 显示 Pin/Export/Delete）
 * - System：Gateway 状态卡 + Recent logs（agent/errors/gateway/desktop + ALL/INFO/WARNING/ERROR）
 * - Usage：7d/30d/90d + 统计卡（Sessions/API calls/Tokens in/out）+ Daily tokens 堆叠柱状图 + Top 列表
 * - Maintenance：Diagnostics / {t("commands.skillCurator")} / {t("commands.memoryData")}
 */

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  Download,
  MessageCircle,
  Search,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react";

interface Section {
  id: string;
  label: string;
  icon: LucideIcon;
  desc: string;
}

const SECTIONS: Section[] = [
  { id: "sessions", label: "sessions", icon: MessageCircle, desc: "Search and manage sessions" },
  { id: "system", label: "system", icon: Activity, desc: "Status, logs, and system actions" },
  { id: "usage", label: "usage", icon: BarChart3, desc: "Token, cost, and skill activity over time" },
  { id: "maintenance", label: "maintenance", icon: Wrench, desc: "Diagnostics, backups, curator, and memory data" },
];

const SESSIONS = [
  { title: "主项目会话", time: "2026-08-09 09:12", pinned: true },
  { title: "架构讨论", time: "2026-08-08 16:40", pinned: false },
  { title: "Rust 后端重构", time: "2026-08-06 14:02", pinned: false },
  { title: "依赖升级", time: "2026-08-04 11:30", pinned: false },
  { title: "语音交互优化", time: "2026-07-30 10:15", pinned: false },
  { title: "浏览器功能", time: "2026-07-28 15:22", pinned: false },
];

// Daily tokens 14 天（input/output 对）
const DAILY_TOKENS = [
  { day: "Jul 27", input: 120, output: 180 },
  { day: "Jul 28", input: 80, output: 140 },
  { day: "Jul 29", input: 200, output: 260 },
  { day: "Jul 30", input: 150, output: 220 },
  { day: "Jul 31", input: 90, output: 160 },
  { day: "Aug 1", input: 240, output: 300 },
  { day: "Aug 2", input: 130, output: 190 },
  { day: "Aug 3", input: 180, output: 250 },
  { day: "Aug 4", input: 100, output: 170 },
  { day: "Aug 5", input: 210, output: 280 },
  { day: "Aug 6", input: 160, output: 230 },
  { day: "Aug 7", input: 260, output: 320 },
  { day: "Aug 8", input: 140, output: 210 },
  { day: "Aug 9", input: 220, output: 290 },
];

const LOG_LINES = [
  { level: "INFO", text: "gateway started on port 17891" },
  { level: "INFO", text: "session created: 主项目会话" },
  { level: "INFO", text: "model loaded: hermes-1.5-pro" },
  { level: "INFO", text: "tool invoked: search_files" },
  { level: "WARNING", text: "rate limit approaching (78%)" },
  { level: "INFO", text: "message streamed: 400 tokens" },
  { level: "ERROR", text: "failed to reach model endpoint (timeout)" },
  { level: "INFO", text: "retrying in 5s…" },
];

export function CommandCenterOverlay({ initialTab = "sessions" }: { initialTab?: string }) {
  const { t } = useI18n();
  const [active, setActive] = useState(initialTab);
  const [search, setSearch] = useState("");
  const [pinned, setPinned] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(SESSIONS.map((s) => [s.title, s.pinned])),
  );
  const [days, setDays] = useState<"7d" | "30d" | "90d">("30d");
  const [logFile, setLogFile] = useState("agent");
  const [logLevel, setLogLevel] = useState("all");

  const section = SECTIONS.find((s) => s.id === active)!;

  return (
    <div className="flex h-full">
      {/* 左侧 4 节导航 */}
      <div className="flex w-14 shrink-0 flex-col items-center border-r border-border py-2">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setActive(s.id)}
            title={t(`commands.${s.label}`)}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-md transition-colors",
              active === s.id ? "bg-muted text-[#303030]" : "text-[#464646] hover:bg-muted/60",
            )}
          >
            <s.icon className="h-5 w-5" strokeWidth={2} />
          </button>
        ))}
      </div>

      {/* 右侧内容 */}
      <div className="min-h-0 flex-1">
        {/* 分区头部 */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <h3 className="text-member font-bold text-[#303030]">{t(`commands.${section.label}`)}</h3>
            <p className="text-[11px] text-muted-foreground">{t(`commands.${section.label}Desc`)}</p>
          </div>
          {active === "sessions" && (
            <div className="relative w-56">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("commands.searchSessions")}
                className="w-full rounded-md border border-border bg-white py-1.5 pl-7 pr-2 text-body-sm text-[#303030] placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#303030]/10"
              />
              <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            </div>
          )}
          {active === "usage" && (
            <div className="flex overflow-hidden rounded-md border border-border">
              {["7d", "30d", "90d"].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d as typeof days)}
                  className={cn("px-2.5 py-1 text-xs transition-colors", days === d ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground")}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 内容 */}
        <div className="h-[calc(100%-49px)] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {active === "sessions" && (
            <div className="p-2">
              {SESSIONS.filter((s) => !search || s.title.includes(search)).map((s) => (
                <div key={s.title} className="group flex items-center gap-2 rounded-md px-2 py-2 transition-colors hover:bg-muted/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-[#303030]">{s.title}</span>
                    <span className="block text-[11px] text-muted-foreground">{s.time}</span>
                  </span>
                  <button
                    onClick={() => setPinned((p) => ({ ...p, [s.title]: !p[s.title] }))}
                    title={pinned[s.title] ? "Unpin session" : "Pin session"}
                    className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted group-hover:opacity-100"
                  >
                    <Bookmark className={cn("h-3.5 w-3.5", pinned[s.title] && "fill-[#F59E0B] text-[#F59E0B] opacity-100")} strokeWidth={2} />
                  </button>
                  <button title={t("commands.exportSession")} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted group-hover:opacity-100">
                    <Download className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button title={t("commands.deleteSession")} className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all hover:bg-muted hover:text-[#EF4444] group-hover:opacity-100">
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              ))}
              {SESSIONS.filter((s) => !search || s.title.includes(search)).length === 0 && (
                <p className="p-4 text-center text-body-sm text-muted-foreground">{t("commands.noResults")}</p>
              )}
            </div>
          )}

          {active === "system" && (
            <div className="p-4">
              <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
                <span className="h-2.5 w-2.5 rounded-full bg-[#10B981]" />
                <div className="flex-1">
                  <p className="text-body-sm font-medium text-[#303030]">{t("commands.gatewayRunning")}</p>
                  <p className="text-[11px] text-muted-foreground">Mirach v0.22.0 · 2 {t("commands.activeSessions")}</p>
                </div>
                <button className="rounded-md border border-border px-2.5 py-1 text-xs text-[#303030] transition-colors hover:bg-muted">{t("commands.restartGateway")}</button>
                <button className="rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#464646]">{t("commands.updateMirach")}</button>
              </div>

              <div className="mt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("commands.recentLogs")}</p>
                <div className="mt-1.5 flex items-center gap-1 border-b border-border pb-2">
                  <input placeholder={t("commands.filterLogs")} className="h-6 w-40 rounded-md border border-border bg-white px-2 text-[11px] text-[#303030] placeholder:text-muted-foreground focus:outline-none" />
                  {["agent", "errors", "gateway", "desktop"].map((f) => (
                    <button
                      key={f}
                      onClick={() => setLogFile(f)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-xs transition-colors",
                        logFile === f ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground hover:bg-muted/60",
                      )}
                    >
                      {f}
                    </button>
                  ))}
                  <div className="ml-auto flex overflow-hidden rounded-md border border-border">
                    {["all", "info", "warning", "error"].map((l) => (
                      <button
                        key={l}
                        onClick={() => setLogLevel(l)}
                        className={cn("px-2 py-0.5 text-[11px] transition-colors", logLevel === l ? "bg-muted font-medium text-[#303030]" : "text-muted-foreground")}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="mt-2 rounded-lg border border-border bg-[#1E1E1E] p-3 font-mono text-[11px] leading-relaxed">
                  {LOG_LINES.filter((l) => logLevel === "all" || l.level.toLowerCase() === logLevel).map((line, i) => (
                    <p key={i} className={cn(
                      line.level === "ERROR" ? "text-[#F87171]" : line.level === "WARNING" ? "text-[#FBBF24]" : "text-[#9CA3AF]",
                    )}>
                      <span className="mr-2 text-[#6B7280]">[{line.level}]</span>
                      {line.text}
                    </p>
                  ))}
                  {LOG_LINES.filter((l) => logLevel === "all" || l.level.toLowerCase() === logLevel).length === 0 && (
                    <p className="text-[#6B7280]">{t("commands.noLogs")}</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {active === "usage" && (
            <div className="p-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "sessions", value: "128" },
                  { label: "API calls", value: "2,431" },
                  { label: "Tokens in/out", value: "3.1M / 5.1M" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-border p-3">
                    <p className="text-[11px] text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-subheading font-bold tabular-nums text-[#303030]">{s.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-lg border border-border p-4">
                <p className="text-body-sm font-medium text-[#303030]">{t("commands.dailyTokens")}</p>
                <div className="mt-3 flex h-32 items-end gap-1">
                  {DAILY_TOKENS.map((d) => {
                    const max = Math.max(...DAILY_TOKENS.map((x) => x.input + x.output));
                    return (
                      <div key={d.day} className="group relative flex flex-1 flex-col justify-end gap-px" title={`${d.day} · in ${d.input} · out ${d.output}`}>
                        <div className="w-full rounded-t-sm bg-emerald-500/60 transition-colors group-hover:bg-emerald-500" style={{ height: `${(d.output / max) * 100}%` }} />
                        <div className="w-full rounded-t-sm bg-[#6366F1]/60 transition-colors group-hover:bg-[#6366F1]" style={{ height: `${(d.input / max) * 100}%` }} />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className="h-2 w-2 rounded-sm bg-[#6366F1]" />{t("commands.legendInput")}</span>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground"><span className="h-2 w-2 rounded-sm bg-emerald-500" />{t("commands.legendOutput")}</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">{DAILY_TOKENS[0].day} — {DAILY_TOKENS[DAILY_TOKENS.length - 1].day}</span>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {[
                  { label: "Top models", rows: [["hermes-1.5-pro", "4,921,340"], ["gpt-4o", "1,672,901"], ["claude-3.5-sonnet", "956,422"], ["hermes-1.5-mini", "621,110"], ["gpt-4o-mini", "312,778"], ["其他", "88,401"]] },
                  { label: "Top skills", rows: [["file search", "1,024 actions"], ["code edit", "866 actions"], ["web browse", "512 actions"], ["terminal", "388 actions"], ["doc summarize", "244 actions"], ["email write", "120 actions"]] },
                ].map((g) => (
                  <div key={g.label} className="rounded-lg border border-border p-3">
                    <p className="text-[11px] font-medium text-muted-foreground">{g.label}</p>
                    {g.rows.map((r) => (
                      <div key={r[0]} className="mt-1.5 flex items-center justify-between text-body-sm">
                        <span className="truncate text-[#303030]">{r[0]}</span>
                        <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{r[1]}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {active === "maintenance" && (
            <div className="space-y-5 p-4">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("commands.diagnostics")}</p>
                <div className="mt-1.5 space-y-1.5">
                  {[
                    { title: t("commands.runDoctor"), desc: "Health-check the install, config, and providers" },
                    { title: t("commands.securityAudit"), desc: "Scan config and skills for risky settings" },
                    { title: t("commands.createBackup"), desc: "Zip config, memories, skills, and sessions" },
                    { title: t("commands.debugShare"), desc: "Upload a redacted report + logs, get shareable links (auto-deletes in 6h)" },
                  ].map((o) => (
                    <div key={o.title} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                      <div>
                        <p className="text-body-sm font-medium text-[#303030]">{o.title}</p>
                        <p className="text-[11px] text-muted-foreground">{o.desc}</p>
                      </div>
                      <button className="rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted">{o.title}</button>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("commands.skillCurator")}</p>
                <div className="mt-1.5 flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-body-sm font-medium text-[#303030]">{t("commands.skillCurator")}</p>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-[#059669]">Active</span>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">Background review that archives stale agent-created skills · Last run today, 09:00</p>
                  </div>
                  <div className="flex gap-1.5">
                    <button className="rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted">{t("commands.pause")}</button>
                    <button className="rounded-md bg-[#303030] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-[#464646]">{t("commands.runNow")}</button>
                  </div>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("commands.memoryData")}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">Built-in memory files injected into every session · Active provider: built-in</p>
                <div className="mt-1.5 space-y-1.5">
                  {[
                    { title: "Agent memory (MEMORY.md)", size: "2.4 KB" },
                    { title: "User profile (USER.md)", size: "1.1 KB" },
                  ].map((m) => (
                    <div key={m.title} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <p className="text-body-sm text-[#303030]">{m.title}</p>
                        <span className="text-[11px] text-muted-foreground">{m.size}</span>
                      </div>
                      <button className="text-xs text-[#EF4444] transition-colors hover:underline">
                        {m.title.includes("MEMORY") ? t("commands.resetMemory") : t("commands.resetProfile")}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-body-sm text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={2} />
                Recent update check: 3 days ago
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
