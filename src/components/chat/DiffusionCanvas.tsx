/**
 * DiffusionCanvas — 图片生成占位的 ASCII 扩散动画（S3-5，对应原型 image-generation-placeholder）
 *
 * canvas 上绘制字符噪声网格，随 denoise 进度逐格收敛为 RAMP 稳定字符：
 * 低亮度格先稳定、高亮度格最后浮现 —— 形成「从噪声中渐渐显影」的效果。
 * rAF 驱动；每个格子有确定性种子，保证稳定字符位置稳定。
 */

import { useEffect, useRef } from "react";

const RAMP = "' .,:;-=+*#%@";
const COLS = 88;
const ROWS = 26;
const CYCLE = 150; // 一个 denoise 周期的帧数

/** 确定性格值（0..1）：决定稳定时机与最终字符 */
function cellValue(x: number, y: number): number {
  let h = (x * 73856093) ^ (y * 19349663);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function DiffusionCanvas({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = (canvas.width = COLS * 10);
    const H = (canvas.height = ROWS * 16);
    const cellW = W / COLS;
    const cellH = H / ROWS;

    let raf = 0;
    let frame = 0;

    const draw = () => {
      const p = (frame % CYCLE) / CYCLE; // denoise 进度 0..1
      frame += 1;

      ctx.fillStyle = "#0B1020";
      ctx.fillRect(0, 0, W, H);
      ctx.font = "10px 'JetBrains Mono', ui-monospace, monospace";

      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const v = cellValue(x, y);
          const threshold = 0.35 + v * 0.55;
          if (p >= threshold) {
            // 已稳定：按格值选 RAMP 字符（越亮越靠后），主题靛蓝渐显
            ctx.fillStyle = "#6366F1";
            ctx.globalAlpha = 0.45 + 0.55 * v;
            ctx.fillText(RAMP[Math.floor(v * RAMP.length)], x * cellW, (y + 1) * cellH);
          } else {
            // 噪声：随机高位字符，灰紫微光
            ctx.fillStyle = "#7C83B8";
            ctx.globalAlpha = 0.9;
            ctx.fillText(RAMP[Math.floor(Math.random() * RAMP.length)], x * cellW, (y + 1) * cellH);
          }
        }
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <canvas
      ref={ref}
      className={className}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
      aria-label="生成中（扩散占位动画）"
    />
  );
}
