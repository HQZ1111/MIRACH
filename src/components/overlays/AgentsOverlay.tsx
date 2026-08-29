/**
 * AgentsOverlay — 子代理目录树（对齐 dsh SubagentCatalogAction 结构）
 *
 * - 头部触发器 chip：子代理总数 + 运行中计数（运行中显示 StateDot ongoing）
 * - 递归目录树：每行 = 展开箭头（有子级时）+ 状态点 + 主标签 +
 *   副行（title · mode · activity）+ 右侧指标（tokens · duration）
 * - 懒展开：仅展开的父节点加载/显示其子目录
 * - 真实模式：引擎 /bg list 后台任务作为根目录（刷新按钮重拉）；
 *   mock 模式：SEED 委派分组树（含流式行/文件明细）
 */

import { useEffect, useState } from "react";
import { OverlayShell } from "@/components/overlays/OverlayShell";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { SESSION_ID } from "@/store/chat";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Loader2,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LineKind = "running" | "done" | "tool" | "thinking" | "error";

interface StreamLine {
  kind: LineKind;
  text: string;
}

/** 目录树节点（dsh CatalogEntry 对齐：child 行含 mode/activity/hasChildren + 指标） */
interface CatalogNode {
  id: string;
  label: string;
  title?: string;
  mode: "one-shot" | "continuable";
  activity: "running" | "inactive";
  status: "running" | "done" | "failed" | "error";
  hasChildren: boolean;
  children?: CatalogNode[];
  /** 右侧指标：tokens（K 缩放显示）+ 时长（秒 → 可读） */
  tokens?: number;
  durationMs?: number;
  // 叶子明细（原 SubagentRow 内容）
  model?: string;
  lines?: StreamLine[];
  filesWritten?: string[];
  filesRead?: string[];
}

// ---- mock：委派分组树 ----
interface SeedAgent {
  id: string;
  goal: string;
  model: string;
  duration: string;
  tools: number;
  tokens: string;
  age: string;
  status: "running" | "done" | "failed";
  lines: StreamLine[];
  filesWritten: string[];
  filesRead: string[];
}

interface SeedGroup {
  id: string;
  title: string;
  n: number;
  active: number;
  agents: SeedAgent[];
}

const SEED: SeedGroup[] = [
  {
    id: "g1",
    title: "重构 Git 审查模块",
    n: 3,
    active: 1,
    agents: [
      {
        id: "a1",
        goal: "梳理 GitReviewPanel 现状与 diff 渲染链路",
        model: "deepseek-v4-flash",
        duration: "1m 24s",
        tools: 3,
        tokens: "2.1K",
        age: "2m 前",
        status: "running",
        lines: [
          { kind: "thinking", text: "定位 GitReviewPanel.tsx 的 diff 渲染入口…" },
          { kind: "tool", text: "读取 GitReviewPanel.tsx（L1-210）" },
          { kind: "running", text: "分析 stage/unstage 与 diff 组件交互" },
        ],
        filesRead: ["src/components/files/GitReviewPanel.tsx"],
        filesWritten: [],
      },
      {
        id: "a2",
        goal: "实现 per-file diff 视图（shiki 高亮）",
        model: "deepseek-v4-flash",
        duration: "4m 02s",
        tools: 5,
        tokens: "8.4K",
        age: "6m 前",
        status: "done",
        lines: [
          { kind: "thinking", text: "选择 shiki 高亮方案…" },
          { kind: "tool", text: "编写 FileDiffPanel 组件" },
          { kind: "done", text: "新增 src/components/files/FileDiffPanel.tsx" },
        ],
        filesRead: ["src/components/files/GitReviewPanel.tsx", "package.json"],
        filesWritten: ["src/components/files/FileDiffPanel.tsx"],
      },
      {
        id: "a3",
        goal: "编写 Git 命令的 Rust 后端测试",
        model: "glm-5p2",
        duration: "2m 10s",
        tools: 2,
        tokens: "1.2K",
        age: "8m 前",
        status: "failed",
        lines: [
          { kind: "thinking", text: "设计 mock 仓库 fixture…" },
          { kind: "error", text: "git 二进制不可用：拒绝执行" },
        ],
        filesRead: [],
        filesWritten: [],
      },
    ],
  },
  {
    id: "g2",
    title: "终端 pty 集成调研",
    n: 1,
    active: 0,
    agents: [
      {
        id: "a4",
        goal: "评估 portable-pty 在 Windows 的可用性",
        model: "kimi-k2p6",
        duration: "3m 45s",
        tools: 4,
        tokens: "5.0K",
        age: "12m 前",
        status: "done",
        lines: [
          { kind: "tool", text: "查询 crates.io portable-pty 文档" },
          { kind: "done", text: "结论：支持 conpty，可复用 xterm.js 前端" },
        ],
        filesRead: [],
        filesWritten: ["docs/pty-research.md"],
      },
    ],
  },
];

function LineGlyph({ kind }: { kind: LineKind }) {
  switch (kind) {
    case "running":
      return <Loader2 className="h-3 w-3 shrink-0 animate-spin text-[#6366F1]" />;
    case "done":
      return <Check className="h-3 w-3 shrink-0 text-[#10B981]" strokeWidth={2.5} />;
    case "tool":
      return <Circle className="h-2.5 w-2.5 shrink-0 fill-[#9CA3AF] text-[#9CA3AF]" />;
    case "thinking":
      return <MoreHorizontal className="h-3 w-3 shrink-0 text-[#F59E0B]" />;
    case "error":
      return <AlertCircle className="h-3 w-3 shrink-0 text-[#EF4444]" />;
  }
}

/** 状态点（dsh StateDot：ongoing / done / error） */
function StateDot({ state }: { state: "ongoing" | "done" | "error" }) {
  return (
    <span
      className={cn(
        "h-2 w-2 shrink-0 rounded-full",
        state === "ongoing" && "bg-[#6366F1]",
        state === "done" && "bg-[#10B981]",
        state === "error" && "bg-[#EF4444]",
      )}
    />
  );
}

/** 时长（ms）→ 可读（dsh formatDuration 简化版） */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** tokens → 1.2K / 3.4M（dsh formatTokens 对齐） */
function formatTokens(value: number): string {
  const scaled = (n: number): string => (n >= 100 ? String(Math.round(n)) : String(Math.round(n * 10) / 10));
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${scaled(value / 1000)}K`;
  return `${scaled(value / 1_000_000)}M`;
}

/** 解析引擎 /bg list 输出（- id [Status] prompt）为叶子节点 */
function parseBgTasks(output: string): CatalogNode[] {
  const lines = output.split("\n");
  const nodes: CatalogNode[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("- ")) continue;
    const body = line.slice(2);
    const match = /^(\S+)\s+\[([^\]]+)\]\s*(.*)$/.exec(body);
    if (!match) continue;
    const [, id, statusRaw, prompt] = match;
    const status = statusRaw.toLowerCase();
    const failed = status.startsWith("failed");
    const running = status.startsWith("running");
    const cancelled = status.startsWith("cancelled");
    nodes.push({
      id,
      label: prompt.trim() || id,
      mode: "continuable",
      activity: running ? "running" : "inactive",
      status: failed ? "failed" : cancelled ? "error" : running ? "running" : "done",
      hasChildren: false,
    });
  }
  return nodes;
}

/** 树统计（dsh indexSubagentDescendants 对齐：count + runningCount） */
function indexDescendants(nodes: CatalogNode[]): { count: number; runningCount: number } {
  let count = 0;
  let runningCount = 0;
  const visit = (list: CatalogNode[]): void => {
    for (const n of list) {
      count += 1;
      if (n.activity === "running") runningCount += 1;
      if (n.children) visit(n.children);
    }
  };
  visit(nodes);
  return { count, runningCount };
}

/** 递归目录行（dsh CatalogRows 对齐：懒展开 + 键盘导航 + 指标） */
function TreeRows({
  nodes,
  expanded,
  toggle,
  level,
  onOpen,
}: {
  nodes: CatalogNode[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  level: number;
  onOpen: (n: CatalogNode) => void;
}) {
  const reserveDisclosure = nodes.some((n) => n.hasChildren);
  return (
    <>
      {nodes.map((n) => {
        const isExpanded = expanded.has(n.id);
        const secondary = [n.title, n.mode === "one-shot" ? "一次性" : "可续聊", n.activity === "running" ? "运行中" : "空闲"]
          .filter(Boolean)
          .join(" · ");
        const metrics = [
          n.tokens !== undefined ? `${formatTokens(n.tokens)} tok` : undefined,
          n.durationMs !== undefined ? formatDuration(n.durationMs) : undefined,
        ].filter(Boolean).join(" · ");
        return (
          <div key={n.id}>
            <div
              role="treeitem"
              aria-level={level}
              aria-expanded={n.hasChildren ? isExpanded : undefined}
              tabIndex={0}
              onClick={() => {
                if (n.hasChildren) toggle(n.id);
                onOpen(n);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (n.hasChildren) toggle(n.id);
                  onOpen(n);
                } else if ((e.key === "ArrowRight" && n.hasChildren && !isExpanded) || (e.key === "ArrowLeft" && isExpanded)) {
                  e.preventDefault();
                  toggle(n.id);
                }
              }}
              className={cn(
                "group flex w-full cursor-pointer items-center gap-2 border-b border-border/60 px-4 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/60",
                level > 1 && "pl-[52px]",
              )}
              style={{ paddingLeft: level > 1 ? 12 + level * 20 : undefined }}
            >
              {n.hasChildren ? (
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(n.id);
                  }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-[#303030]"
                  aria-label={isExpanded ? "折叠" : "展开"}
                >
                  {isExpanded ? (
                    <ChevronDown size={13} strokeWidth={2.5} />
                  ) : (
                    <ChevronRight size={13} strokeWidth={2.5} />
                  )}
                </button>
              ) : reserveDisclosure ? (
                <span className="w-[13px] shrink-0" />
              ) : null}
              <StateDot
                state={
                  n.status === "running" ? "ongoing" : n.status === "failed" || n.status === "error" ? "error" : "done"
                }
              />
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-body-sm", n.activity === "running" ? "font-medium text-[#303030]" : "text-[#303030]")}>
                  {n.label}
                </span>
                {secondary && (
                  <span className="block truncate text-[11px] text-muted-foreground">{secondary}</span>
                )}
              </span>
              {metrics && <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{metrics}</span>}
            </div>
            {n.hasChildren && isExpanded && n.children && (
              <div role="group">
                <TreeRows nodes={n.children} expanded={expanded} toggle={toggle} level={level + 1} onOpen={onOpen} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** 选中节点明细（叶子：流式行 + 文件；分组：摘要） */
function NodeDetail({ node }: { node: CatalogNode }) {
  const lines = node.lines ?? [];
  const files = [
    ...(node.filesWritten ?? []).map((f) => `+ ${f}`),
    ...(node.filesRead ?? []).map((f) => `- ${f}`),
  ];
  return (
    <div className="space-y-1 pb-2 pl-[52px] pr-4">
      {lines.map((l, i) => (
        <div key={i} className="flex items-center gap-2 text-body-sm text-[#464646]">
          <LineGlyph kind={l.kind} />
          <span className="truncate">{l.text}</span>
        </div>
      ))}
      {node.model && lines.length > 0 && (
        <p className="text-[11px] text-muted-foreground">模型：{node.model}</p>
      )}
      {files.length > 0 && (
        <div className="pt-0.5">
          <p className="mb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">文件</p>
          {files.slice(0, 8).map((f, i) => (
            <p key={i} className="truncate font-mono text-[11px] text-[#464646]">{f}</p>
          ))}
          {files.length > 8 && <p className="text-[11px] text-muted-foreground">+ {files.length - 8} 更多</p>}
        </div>
      )}
    </div>
  );
}

/** 代理派生树内容（无外壳，供 OverlayShell 或拓展标签页内嵌复用） */
export function AgentsTreeContent() {
  // mock：SEED 分组树（分组 → 子代理叶子）；real：引擎 /bg list 后台任务
  const seedTree: CatalogNode[] = SEED.map((g) => ({
    id: g.id,
    label: g.title,
    title: `Delegation ${g.n} · ${g.n} workers · ${g.active} active`,
    mode: "continuable" as const,
    activity: (g.active > 0 ? "running" : "inactive") as "running" | "inactive",
    status: g.active > 0 ? ("running" as const) : ("done" as const),
    hasChildren: true,
    children: g.agents.map((a) => ({
      id: a.id,
      label: a.goal,
      title: `${a.model} · ${a.age}`,
      mode: "one-shot" as const,
      activity: (a.status === "running" ? "running" : "inactive") as "running" | "inactive",
      status: a.status,
      hasChildren: false,
      tokens: a.tokens === "2.1K" ? 2100 : a.tokens === "8.4K" ? 8400 : a.tokens === "1.2K" ? 1200 : 5000,
      durationMs: a.duration === "1m 24s" ? 84_000 : a.duration === "4m 02s" ? 242_000 : a.duration === "2m 10s" ? 130_000 : 225_000,
      model: a.model,
      lines: a.lines,
      filesWritten: a.filesWritten,
      filesRead: a.filesRead,
    })),
  }));

  const [roots, setRoots] = useState<CatalogNode[]>(seedTree);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(SEED.map((g) => g.id)));
  const [selected, setSelected] = useState<CatalogNode>(seedTree[0]?.children?.[0] ?? seedTree[0]);
  const [bgError, setBgError] = useState<string | null>(null);

  // ---- 真实模式：引擎后台任务目录（/bg list） ----
  const loadBg = (): void => {
    if (MOCK) return;
    setBgError(null);
    void getApi()
      .runCommand(SESSION_ID, "/bg list")
      .then((res) => {
        const nodes = parseBgTasks(res.output);
        if (nodes.length === 0) {
          setRoots([{ id: "__empty", label: "暂无后台任务（/btw 或 /bg 启动）", mode: "continuable", activity: "inactive", status: "done", hasChildren: false }]);
        } else {
          setRoots(nodes);
        }
      })
      .catch(() => setBgError("引擎不可达：无法读取后台任务"));
  };
  useEffect(() => {
    if (!MOCK) loadBg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const descendants = indexDescendants(roots);
  const stats = {
    agents: descendants.count,
    active: descendants.runningCount,
    failed: roots.flatMap((r) => r.children ?? []).filter((a) => a.status === "failed").length,
    tools: roots.flatMap((r) => r.children ?? []).reduce((s, a) => s + (a.lines ?? []).filter((l) => l.kind === "tool").length, 0),
    tokens: roots.flatMap((r) => r.children ?? []).reduce((s, a) => s + (a.tokens ?? 0), 0),
  };

  return (
    <div className="flex h-full flex-col">
      {/* ---- 头部：统计 + 目录触发器 chip（dsh trigger 对齐） ---- */}
      <div className="flex shrink-0 items-center gap-5 border-b border-border px-5 py-2.5 text-body-sm text-muted-foreground">
        <span>
          子代理 <span className="font-medium text-[#303030]">{stats.agents}</span>
        </span>
        <span>
          活跃 <span className="font-medium text-[#6366F1]">{stats.active}</span>
        </span>
        <span>
          失败 <span className="font-medium text-[#EF4444]">{stats.failed}</span>
        </span>
        <span>
          工具 <span className="font-medium text-[#303030]">{stats.tools}</span>
        </span>
        <span>
          Tokens <span className="font-medium text-[#303030]">{formatTokens(stats.tokens)}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          {bgError && <span className="text-[11px] text-[#EF4444]">{bgError}</span>}
          {!MOCK && (
            <button
              onClick={loadBg}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-[#464646] transition-colors hover:bg-muted"
            >
              <RefreshCw className="h-3 w-3" strokeWidth={2} />
              刷新
            </button>
          )}
          {/* 目录触发器（dsh SubagentCatalogAction trigger：计数 + 运行中点） */}
          <span
            className="flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-[#303030]"
            title={`${descendants.count} 个子代理${descendants.runningCount > 0 ? `，${descendants.runningCount} 个运行中` : ""}`}
          >
            {descendants.runningCount > 0 && <StateDot state="ongoing" />}
            <span className="tabular-nums">{descendants.count}</span>
            <span className="text-muted-foreground">子代理</span>
            {descendants.runningCount > 0 && (
              <span className="tabular-nums text-[#6366F1]">· {descendants.runningCount} 运行中</span>
            )}
          </span>
        </div>
      </div>

      {/* ---- 递归目录树 ---- */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <TreeRows nodes={roots} expanded={expanded} toggle={toggle} level={1} onOpen={setSelected} />
        {/* 选中叶子明细（仅非 mock 后台任务节点不展开行内明细时展示） */}
        {selected && !selected.hasChildren && (selected.lines?.length ?? 0) > 0 && (
          <div className="border-b border-border/60">
            <NodeDetail node={selected} />
          </div>
        )}
      </div>
    </div>
  );
}

export function AgentsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <OverlayShell title="代理" onClose={onClose} width={1040} height={720}>
      <AgentsTreeContent />
    </OverlayShell>
  );
}
