/**
 * kernel-ready — 官方对话内核（客户端栈）真实就绪状态
 *
 * 语义：引擎（sidecar + dsh runtime）就绪 ≠ 内核就绪。内核是渲染进程里的
 * 官方客户端栈（KERNEL_PLUGINS 激活 + ctx.sessions 注册 + 官方根树可渲染）；
 * 只有两者都就绪，对话区才真正可用。启动门与右栏网关状态点都消费本 store。
 *
 * 写入点唯一：dsh-kernel/boot.ts 的 bootKernelMirrorOnce（成功/失败/重置）。
 */

import { atom } from "nanostores";

/** 官方内核是否已激活并可渲染（boot 完成且 ctx.sessions 已注册）。 */
export const $kernelReady = atom(false);

/** 内核未就绪/失败原因（展示用；null = 无错误）。 */
export const $kernelError = atom<string | null>(null);

export function setKernelReady(ready: boolean, error: string | null = null): void {
  $kernelReady.set(ready);
  $kernelError.set(ready ? null : error);
}
