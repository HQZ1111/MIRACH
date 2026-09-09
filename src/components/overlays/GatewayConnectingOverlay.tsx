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
import { $kernelError, $kernelReady } from "@/store/kernel-ready";
import { $kernelConnection } from "@/store/kernel-connection";

const TARGET = "正在连接引擎…";
const RANDOM_CHARS = "01ABCDEF#$%&*+=?<>";

export function GatewayConnectingOverlay() {
  const boot = useStore($desktopBoot);
  const kernelReady = useStore($kernelReady);
  const kernelError = useStore($kernelError);
  const kernelConnection = useStore($kernelConnection);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const t = window.setInterval(() => setTick((v) => v + 1), 70);
    return () => window.clearInterval(t);
  }, []);

  // 内核激活失败/未就绪时的自愈：引擎已就绪仍不见内核 → 每 5s 重试一次
  // bootKernelMirror（boot 内部有单飞去重；成功置 $kernelReady，门自动放行）。
  useEffect(() => {
    if (kernelReady) return;
    let tries = 0;
    const t = window.setInterval(() => {
      if (tries++ > 12) {
        window.clearInterval(t);
        return;
      }
      void import("@/dsh-kernel/boot")
        .then((m) => m.bootKernelMirror())
        .catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [kernelReady]);

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
        {/* 内核（官方客户端栈）真实状态：引擎就绪后仍在这里等它 */}
        {!kernelReady && (
          <p className="max-w-72 text-center text-[11px] text-[#C7CCE8]/70">
            {kernelError ?? "正在激活官方对话内核…"}
          </p>
        )}
        {/* 内核已就绪但 RPC 载体未连通（引擎 web 面未监听/掉线）：显示真结论 */}
        {kernelReady && kernelConnection !== "open" && (
          <p className="max-w-72 text-center text-[11px] text-[#C7CCE8]/70">
            {kernelConnection === "closed"
              ? "对话内核连接已断开，正在自动重连…"
              : "对话内核正在连接引擎…"}
          </p>
        )}
        {/* 启动失败：给出重试与退出（不能把用户困在启动页） */}
        {(boot.error || kernelError) && (
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => {
                void import("@/store/gateway").then((m) => m.pingGateway());
                void import("@/dsh-kernel/boot").then((m) => m.bootKernelMirror()).catch(() => {});
              }}
              className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-[#C7CCE8] transition-colors hover:bg-white/10"
            >
              重试
            </button>
            <button
              onClick={() => {
                void import("@tauri-apps/api/window")
                  .then((m) => m.getCurrentWindow().close())
                  .catch(() => {});
              }}
              className="rounded-md bg-white/10 px-3 py-1.5 text-xs text-[#C7CCE8] transition-colors hover:bg-white/20"
            >
              退出应用
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
