/**
 * kernel-connection — 官方客户端内核的**真实连接状态**（唯一真值源）
 *
 * 为什么不能只看 $gatewayState：它是 sidecar 侧的就绪标志（Rust 预热握手 +
 * dsh_engine_ready 命令），"进程握手成功" ≠ "引擎 web 面/内核 RPC 真的通"。
 * 冷启动期引擎进程已起、SDK initialize 已回、但 webserver 还没监听时，
 * $gatewayState 会提前变 open——右侧工具栏按钮因此全程显示"已连接"、
 * 启动门也会误放行。本 store 由内核 boot 订阅官方 ctx.connection.state
 * （ConnectionStateSource：connected / connecting / disconnected）写入，
 * 是真 RPC 载体（$events 流 ready 帧）的结论，启动门/状态点/断联横幅统一消费。
 */

import { atom } from "nanostores";

/** idle=内核未 boot；connecting=载体未建立/重连中；open=官方连接已就绪；closed=连接终止 */
export type KernelConnectionState = "idle" | "connecting" | "open" | "closed";

export const $kernelConnection = atom<KernelConnectionState>("idle");

/** 状态最近一次变化的时间戳（诊断/提示文案用） */
export const $kernelConnectionSince = atom<number>(0);

export function setKernelConnection(state: KernelConnectionState): void {
  if ($kernelConnection.get() === state) return;
  $kernelConnection.set(state);
  $kernelConnectionSince.set(Date.now());
}

/** 引擎/内核任一环节未就绪（按钮与横幅共用的"链路可用"判定） */
export function kernelLinkOpen(
  gatewayState: string,
  kernelReady: boolean,
  kernelConnection: KernelConnectionState,
): boolean {
  return gatewayState === "open" && kernelReady && kernelConnection === "open";
}
