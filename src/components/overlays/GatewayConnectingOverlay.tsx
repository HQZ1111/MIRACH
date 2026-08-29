/**
 * GatewayConnectingOverlay — 引擎连接中浮层（S3-5，对应原型 gateway-connecting-overlay）
 *
 * 解码动画：目标文案逐字符从随机符号解码为正文字符（原型 DecodeText 的克隆）。
 * 仅真实模式显示（mock 恒 open，state 永不进入 connecting）。
 */

import { useEffect, useState } from "react";

const TARGET = "正在连接引擎…";
const RANDOM_CHARS = "01ABCDEF#$%&*+=?<>";

export function GatewayConnectingOverlay() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 70);
    return () => window.clearInterval(t);
  }, []);

  // 每 3 tick 解码一个字符：尚未解码的显示随机符号
  const decoded = TARGET.split("")
    .map((ch, i) => {
      const step = Math.floor(tick / 3);
      if (i === 0 || step >= i) return ch;
      return RANDOM_CHARS[(tick + i * 7) % RANDOM_CHARS.length];
    })
    .join("");

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[#0F1220]/95 backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-14 w-14">
          <div className="absolute inset-0 animate-spin rounded-full border-2 border-[#6366F1]/30 border-t-[#6366F1]" />
        </div>
        <p className="font-mono text-body-sm tracking-[0.3em] text-[#C7CCE8]">{decoded}</p>
        <p className="text-[11px] text-muted-foreground">正在探测引擎网关…</p>
      </div>
    </div>
  );
}
