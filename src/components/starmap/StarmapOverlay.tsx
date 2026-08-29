/**
 * StarmapOverlay — 记忆星图（d3-force + canvas）
 *
 * 节点 = 记忆条目（按类别着色），时间分环（老核心 → 新外环），
 * 连线 = 类别关联。力导向布局持续微调，节点 hover 显示标签。
 * 当前为演示数据；接后端后由 memory 数据驱动。
 */

import { useEffect, useRef } from "react";
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceRadial } from "d3-force";
import { OverlayShell } from "../overlays/OverlayShell";

interface Memory {
  id: string;
  label: string;
  kind: "project" | "user" | "tool" | "skill";
  /** 时间 0（旧）~ 1（新） */
  t: number;
}

const KINDS = ["project", "user", "tool", "skill"] as const;

const COLORS: Record<Memory["kind"], string> = {
  project: "#6366F1",
  user: "#10B981",
  tool: "#F59E0B",
  skill: "#EC4899",
};

const MEMORIES_LEN = 48;

const MEMORIES: Memory[] = Array.from({ length: MEMORIES_LEN }, (_, i) => {
  const kind = KINDS[i % KINDS.length];
  const words = ["认证", "重构", "记忆", "搜索", "渲染", "部署", "缓存", "API", "会话", "技能", "终端", "浏览器"];
  const label = `${kind === "project" ? "项目" : kind === "user" ? "用户" : kind === "tool" ? "工具" : "技能"}·${words[i % words.length]}${Math.floor(i / words.length)}`;
  return { id: `m${i}`, label, kind, t: 0.15 + (i / MEMORIES_LEN) * 0.85 };
});

export function StarmapOverlay({ onClose }: { onClose: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const maybeCtx = canvas.getContext("2d");
    if (!maybeCtx) return;
    const c = maybeCtx;

    const W = (canvas.width = 920);
    const H = (canvas.height = 620);

    const nodes = MEMORIES.map((m, i) => {
      const angle = (i / MEMORIES.length) * Math.PI * 2;
      const r = 70 + m.t * (Math.min(W, H) / 2 - 90);
      return { ...m, x: W / 2 + Math.cos(angle) * r, y: H / 2 + Math.sin(angle) * r, vx: 0, vy: 0 };
    });
    // 同类之间连边（关联）
    const links = nodes.flatMap((n, i) =>
      nodes.slice(i + 1).filter((m, j) => m.kind === n.kind && j < 4).map((m) => ({ source: n, target: m })),
    );

    const sim = forceSimulation(nodes as never)
      .force("charge", forceManyBody().strength(-30))
      .force("link", forceLink(links as never).distance(70).strength(0.2))
      .force("radial", forceRadial(160, W / 2, H / 2).strength(0.12))
      .force("collide", forceCollide(10))
      .alpha(0.6)
      .alphaDecay(0.02)
      .on("tick", draw);

    // 时间环（半径 90/170/250）
    const rings = [90, 170, 250];

    function draw() {
      c.clearRect(0, 0, W, H);
      // 背景
      c.fillStyle = "#0B1020";
      c.fillRect(0, 0, W, H);
      // 星点背景
      c.fillStyle = "rgba(255,255,255,0.25)";
      for (let i = 0; i < 120; i++) {
        const sx = (i * 137.5) % W;
        const sy = (i * 71.3) % H;
        c.fillRect(sx, sy, 1.2, 1.2);
      }
      // 时间环
      rings.forEach((r) => {
        c.beginPath();
        c.arc(W / 2, H / 2, r, 0, Math.PI * 2);
        c.strokeStyle = "rgba(255,255,255,0.08)";
        c.stroke();
      });
      c.fillStyle = "rgba(255,255,255,0.35)";
      c.font = "10px sans-serif";
      c.fillText("老记忆", W / 2 - 22, H / 2 - rings[0] + 12);
      c.fillText("新记忆", W / 2 - 22, H / 2 - rings[2] + 12);

      // 连线
      c.strokeStyle = "rgba(255,255,255,0.08)";
      c.lineWidth = 1;
      (links as { source: { x: number; y: number }; target: { x: number; y: number } }[]).forEach((l) => {
        c.beginPath();
        c.moveTo(l.source.x, l.source.y);
        c.lineTo(l.target.x, l.target.y);
        c.stroke();
      });

      // 节点
      nodes.forEach((n) => {
        c.beginPath();
        c.arc(n.x, n.y, 5, 0, Math.PI * 2);
        c.fillStyle = COLORS[n.kind];
        c.globalAlpha = 0.25;
        c.fill();
        c.globalAlpha = 1;
        c.beginPath();
        c.arc(n.x, n.y, 3.2, 0, Math.PI * 2);
        c.fillStyle = COLORS[n.kind];
        c.fill();
      });
    }

    draw();
    return () => {
      sim.stop();
    };
  }, []);

  return (
    <OverlayShell title="记忆星图" width={980} height={700} onClose={onClose}>
      <div className="relative flex h-full flex-col items-center justify-center bg-[#0B1020]">
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
        <p className="absolute bottom-2 text-[10px] text-white/40">
          演示数据 · d3-force 力导向布局 · 时间分环（内=旧，外=新）
        </p>
      </div>
    </OverlayShell>
  );
}
