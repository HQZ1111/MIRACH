/**
 * StarmapView — 知识星空图（S3-5，对应原型 starmap；替换「知识库」占位页）
 *
 * d3-force 力导向图：把会话 / 项目 / 插件 / 功能枢纽渲染成可拖拽、可缩放、可平移的星空。
 *  - 节点分类着色：枢纽（深色）· 会话（靛蓝）· 项目（琥珀）· 插件（灰绿）
 *  - 拖拽节点（手动 pointer 跟踪，只改 fx/fy 不碰 simulation 结构）
 *  - 滚轮缩放 + 背景拖拽平移（CSS transform，无 d3-zoom 依赖）
 *  - 点击会话节点 → 切换到该会话（回主对话区）
 *  - 时间轴（StarmapTimeline）：48 桶直方图 + 播放渐进点亮会话节点
 *  - 分享码（ShareControls）：HML1 编解码，导入重建星图 / 重置恢复本地
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { $sessions } from "@/store/sessions";
import { $projects } from "@/store/projects";
import { $plugins } from "@/store/plugins";
import { $activeSessionId, setActiveSession } from "@/store/session";
import { ShareControls } from "./ShareControls";
import { StarmapTimeline, type TimelineEntry } from "./StarmapTimeline";
import { ShareCodeError, decodeShareCode, encodeShareCode, type SharePayload } from "@/lib/share-code";

// ----------------------------------------------------------------
// 类型与数据
// ----------------------------------------------------------------

type NodeKind = "hub" | "session" | "project" | "plugin";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
  /** 会话 recency 0（旧）~1（新），时间轴 reveal 联动显隐 */
  recency?: number;
}

interface GraphLink {
  source: string;
  target: string;
}

/** 星图数据快照（本地 store 或导入分享码） */
interface ViewSnapshot {
  sessions: { id: string; title: string; createdAt: number }[];
  projects: { id: string; name: string; sessions: { title: string }[] }[];
  plugins: { id: string; label: string }[];
}

const NODE_RADIUS: Record<NodeKind, number> = { hub: 9, session: 6, project: 7, plugin: 5 };
const NODE_COLOR: Record<NodeKind, string> = {
  hub: "#303030",
  session: "#6366F1",
  project: "#F59E0B",
  plugin: "#10B981",
};

const HUBS: { id: string; label: string }[] = [
  { id: "hub-chat", label: "聊天" },
  { id: "hub-code", label: "代码" },
  { id: "hub-cron", label: "排程" },
  { id: "hub-msg", label: "消息平台" },
  { id: "hub-review", label: "审查" },
];

function buildGraph(data: ViewSnapshot) {
  const nodes: GraphNode[] = HUBS.map((h) => ({ id: h.id, kind: "hub", label: h.label }));
  const links: GraphLink[] = [];

  // 会话节点：按 createdAt 计算 recency（时间轴 reveal 对齐）
  const ts = data.sessions.map((s) => s.createdAt);
  const minTs = ts.length ? Math.min(...ts) : 0;
  const maxTs = ts.length ? Math.max(...ts) : 1;
  const span = maxTs - minTs || 1;

  for (const s of data.sessions.slice(0, 24)) {
    nodes.push({
      id: `s:${s.id}`,
      kind: "session",
      label: s.title,
      recency: (s.createdAt - minTs) / span,
    });
    links.push({ source: "hub-chat", target: `s:${s.id}` });
  }
  for (const p of data.projects) {
    nodes.push({ id: `p:${p.id}`, kind: "project", label: p.name });
    links.push({ source: "hub-code", target: `p:${p.id}` });
    p.sessions.forEach((ps, i) => {
      nodes.push({ id: `p:${p.id}:s${i}`, kind: "session", label: ps.title });
      links.push({ source: `p:${p.id}`, target: `p:${p.id}:s${i}` });
    });
  }
  for (const pl of data.plugins) {
    nodes.push({ id: `pl:${pl.id}`, kind: "plugin", label: pl.label });
    links.push({ source: "hub-chat", target: `pl:${pl.id}` });
    if (pl.id === "cron" || pl.id === "docker") links.push({ source: "hub-code", target: `pl:${pl.id}` });
    if (pl.id === "slack") links.push({ source: "hub-msg", target: `pl:${pl.id}` });
  }

  return { nodes, links };
}

// ----------------------------------------------------------------
// 组件
// ----------------------------------------------------------------

export function StarmapView() {
  const sessions = useStore($sessions);
  const projects = useStore($projects);
  const plugins = useStore($plugins);
  const activeId = useStore($activeSessionId);

  // ---- 分享码 / 导入状态 ----
  const [importData, setImportData] = useState<SharePayload | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [imported, setImported] = useState(false);

  // ---- 时间轴 reveal（0..1）与播放 ----
  const [reveal, setReveal] = useState(1);
  const [playing, setPlaying] = useState(false);
  const revealRef = useRef(reveal);
  revealRef.current = reveal;

  // ---- 数据快照：导入分享码时用分享数据，否则用本地 store ----
  const snapshot = useMemo<ViewSnapshot>(() => {
    if (importData) {
      return {
        sessions: importData.sessions.map((s) => ({
          id: s.id,
          title: s.title,
          createdAt: s.createdAt,
        })),
        projects: (importData.projects ?? []).map((p) => ({ id: p.id, name: p.name, sessions: [] })),
        plugins: (importData.plugins ?? []).map((p) => ({ id: p.id, label: p.label })),
      };
    }
    return {
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, sessions: p.sessions })),
      plugins: plugins.map((p) => ({ id: p.id, label: p.label })),
    };
  }, [importData, sessions, projects, plugins]);

  const { nodes, links } = useMemo(() => buildGraph(snapshot), [snapshot]);

  const timelineEntries = useMemo<TimelineEntry[]>(
    () => snapshot.sessions.map((s) => ({ id: s.id, createdAt: s.createdAt })),
    [snapshot],
  );

  // ---- 播放：rAF 递增 reveal 到 1 自动停 ----
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const step = () => {
      setReveal((v) => {
        const nv = Math.min(1, v + 0.005);
        if (nv >= 1) setPlaying(false);
        return nv;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // ---- 分享码动作 ----
  const handleShare = useCallback(() => {
    const payload: SharePayload = {
      v: 1,
      exportedAt: Date.now(),
      sessions: snapshot.sessions.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt })),
      projects: snapshot.projects.map((p) => ({ id: p.id, name: p.name })),
      plugins: snapshot.plugins.map((p) => ({ id: p.id, label: p.label })),
    };
    setShareCode(encodeShareCode(payload));
  }, [snapshot]);

  const handleImport = useCallback((code: string): string | null => {
    try {
      const payload = decodeShareCode(code);
      setImportData(payload);
      setImported(true);
      setReveal(1);
      return null;
    } catch (err) {
      return err instanceof ShareCodeError ? err.message : "无法解析分享码";
    }
  }, []);

  const handleReset = useCallback(() => {
    setImportData(null);
    setImported(false);
    setShareCode(null);
    setReveal(1);
  }, []);

  // ----------------------------------------------------------------

  const svgRef = useRef<SVGSVGElement>(null);
  const gRef = useRef<SVGGElement>(null);
  const nodeEls = useRef<Record<string, SVGGElement | null>>({});
  const linkEls = useRef<Record<string, SVGLineElement | null>>({});

  // 视口变换（缩放 + 平移）
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef({ x: 0, y: 0, tx: 0, ty: 0, panning: false, nodeId: null as string | null });

  // 构建模拟：依赖 nodes/links 重建
  const simRef = useRef<ReturnType<typeof forceSimulation> | null>(null);

  useEffect(() => {
    const sim = forceSimulation(nodes as any)
      .force("link", forceLink(links as any).id((d: any) => d.id).distance(70).strength(0.5))
      .force("charge", forceManyBody().strength(-220))
      .force("center", forceCenter(0, 0))
      .force("x", forceX(0).strength(0.06))
      .force("y", forceY(0).strength(0.06))
      .force("collide", forceCollide(14))
      .on("tick", () => {
        const g = gRef.current;
        if (!g) return;
        const r = revealRef.current;
        for (const n of nodes as GraphNode[]) {
          const el = nodeEls.current[n.id];
          if (!el) continue;
          el.setAttribute("transform", `translate(${n.x},${n.y})`);
          // 时间轴联动：reveal 未覆盖的会话节点淡化（播放揭示时渐进点亮）
          if (n.kind === "session") {
            const rec = n.recency ?? 1;
            el.setAttribute("opacity", rec <= r ? "1" : "0.05");
          }
        }
        for (const l of links as GraphLink[]) {
          const el = linkEls.current[`${(l.source as any).id ?? l.source}-${(l.target as any).id ?? l.target}`];
          const s = l.source as any;
          const t = l.target as any;
          if (el && s.x != null && t.x != null) {
            el.setAttribute("x1", String(s.x));
            el.setAttribute("y1", String(s.y));
            el.setAttribute("x2", String(t.x));
            el.setAttribute("y2", String(t.y));
          }
        }
      });

    simRef.current = sim;

    // 中心初始化：一次性把所有节点撒到中心附近，避免从 (0,0) 一拥而散
    const w = 800;
    const h = 560;
    nodes.forEach((n) => {
      n.x = (Math.random() - 0.5) * w;
      n.y = (Math.random() - 0.5) * h;
    });
    sim.alpha(0.9).restart();

    return () => {
      sim.stop();
      simRef.current = null;
    };
  }, [nodes, links]);

  // 点击会话节点 → 切换会话
  const handleNodeClick = (n: GraphNode) => {
    if (n.kind === "session") {
      const id = n.id.slice(2); // "s:{id}" → {id}
      if (id) setActiveSession(id);
    }
  };

  // 节点拖拽（手动 pointer 跟踪；只改 fx/fy，不重建模拟）
  const onNodePointerDown = (e: React.PointerEvent, n: GraphNode) => {
    e.stopPropagation();
    const sim = simRef.current;
    if (!sim) return;
    dragRef.current.nodeId = n.id;
    n.fx = n.x;
    n.fy = n.y;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    sim.alphaTarget(0.2).restart();
  };

  const onNodePointerMove = (e: React.PointerEvent) => {
    const { nodeId } = dragRef.current;
    if (!nodeId) return;
    const n = nodes.find((x) => x.id === nodeId);
    if (!n) return;
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { scale, tx, ty } = view;
    n.fx = (e.clientX - rect.left - tx) / scale;
    n.fy = (e.clientY - rect.top - ty) / scale;
  };

  const onNodePointerUp = () => {
    const { nodeId } = dragRef.current;
    if (!nodeId) return;
    const n = nodes.find((x) => x.id === nodeId);
    if (n) {
      n.fx = null;
      n.fy = null;
    }
    dragRef.current.nodeId = null;
    simRef.current?.alphaTarget(0);
  };

  // 背景拖拽平移
  const onBgPointerDown = (e: React.PointerEvent) => {
    dragRef.current.panning = true;
    dragRef.current.x = e.clientX;
    dragRef.current.y = e.clientY;
    dragRef.current.tx = view.tx;
    dragRef.current.ty = view.ty;
  };

  const onBgPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current.panning) return;
    setView((v) => ({
      ...v,
      tx: dragRef.current.tx + (e.clientX - dragRef.current.x),
      ty: dragRef.current.ty + (e.clientY - dragRef.current.y),
    }));
  };

  const onBgPointerUp = () => {
    dragRef.current.panning = false;
  };

  // 滚轮缩放（以鼠标位置为锚点）
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const next = Math.min(2.5, Math.max(0.4, v.scale * factor));
      const k = next / v.scale;
      return {
        scale: next,
        tx: mx - (mx - v.tx) * k,
        ty: my - (my - v.ty) * k,
      };
    });
  };

  const linkKey = (l: GraphLink) => {
    const s = typeof l.source === "object" ? (l.source as any).id : l.source;
    const t = typeof l.target === "object" ? (l.target as any).id : l.target;
    return `${s}-${t}`;
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-6 py-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <p className="text-body-sm font-medium text-[#303030]">知识星空图</p>
          <p className="text-[11px] text-muted-foreground">
            拖拽节点 · 滚轮缩放 · 背景拖拽平移 · 点击会话节点切换会话
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#303030]" /> 枢纽</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#6366F1]" /> 会话</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#F59E0B]" /> 项目</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#10B981]" /> 插件</span>
          </div>
          <ShareControls
            code={shareCode}
            imported={imported}
            onShare={handleShare}
            onImport={handleImport}
            onReset={handleReset}
          />
        </div>
      </div>

      {/* 时间轴：播放揭示 + 拖动 scrub */}
      <div className="mb-2 shrink-0">
        <StarmapTimeline
          entries={timelineEntries}
          reveal={reveal}
          playing={playing}
          onReveal={setReveal}
          onTogglePlay={() => {
            // 已揭示到底时播放先归零，否则从 0 到 1 再播
            if (reveal >= 0.999 && !playing) setReveal(0);
            setPlaying((v) => !v);
          }}
        />
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-[#0F1220]">
        <svg
          ref={svgRef}
          className="h-full w-full cursor-grab active:cursor-grabbing select-none"
          onWheel={onWheel}
          onPointerDown={onBgPointerDown}
          onPointerMove={onBgPointerMove}
          onPointerUp={onBgPointerUp}
          onPointerLeave={onBgPointerUp}
        >
          <defs>
            <radialGradient id="starmap-bg">
              <stop offset="0%" stopColor="#1E2240" />
              <stop offset="100%" stopColor="#0F1220" />
            </radialGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#starmap-bg)" />
          <g
            ref={gRef}
            transform={`translate(${view.tx},${view.ty}) scale(${view.scale})`}
            style={{ transformOrigin: "0 0" }}
          >
            {links.map((l) => (
              <line
                key={linkKey(l)}
                ref={(el) => { linkEls.current[linkKey(l)] = el; }}
                stroke="#3A4168"
                strokeWidth={0.8}
                opacity={0.7}
              />
            ))}
            {nodes.map((n) => (
              <g
                key={n.id}
                ref={(el) => { nodeEls.current[n.id] = el; }}
                onPointerDown={(e) => onNodePointerDown(e, n)}
                onPointerMove={onNodePointerMove}
                onPointerUp={onNodePointerUp}
                onClick={() => handleNodeClick(n)}
                style={{ cursor: n.kind === "session" ? "pointer" : "grab" }}
              >
                <circle r={NODE_RADIUS[n.kind]} fill={NODE_COLOR[n.kind]} opacity={0.95} />
                {n.id === `s:${activeId}` && (
                  <circle r={NODE_RADIUS[n.kind] + 4} fill="none" stroke="#A5B4FC" strokeWidth={1.5} />
                )}
                <text
                  y={-NODE_RADIUS[n.kind] - 5}
                  textAnchor="middle"
                  fill="#C7CCE8"
                  fontSize={10}
                  className="pointer-events-none"
                >
                  {n.label.length > 12 ? `${n.label.slice(0, 11)}…` : n.label}
                </text>
              </g>
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}
