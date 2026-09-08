/**
 * GatewayConnectingOverlay — 引擎连接中浮层（S3-5，对应原型 gateway-connecting-overlay）
 *
 * 解码动画：目标文案逐字符从随机符号解码为正文字符（原型 DecodeText 的克隆）。
 * 进度/阶段消费 $desktopBoot（hermes boot 状态机移植）——显示真实启动阶段，
 * 不再放假进度。仅真实模式显示（mock 恒 open，state 永不进入 connecting）。
 */

import { useEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import { $desktopBoot } from "@/store/boot";

const TARGET = "正在连接引擎…";
const RANDOM_CHARS = "01ABCDEF#$%&*+=?<>";

export function GatewayConnectingOverlay() {
  const boot = useStore($desktopBoot);
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
        {/* 真实启动阶段（boot 状态机）：阶段文案 + 单调进度 */}
        <p className="text-[11px] text-[#C7CCE8]/80">{boot.message}</p>
        <div className="h-1 w-64 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-[#6366F1] transition-all"
            style={{ width: `${boot.progress}%` }}
          />
        </div>
        <p className="text-[11px] tabular-nums text-muted-foreground">{boot.progress}%</p>
      </div>
    </div>
  );
}
