/**
 * gateway - 引擎连接状态 store（S3-5，boot-failure / gateway-connecting / desktop-install 驱动）
 *
 * 状态机：idle（首次运行，未探测）→ connecting → open / error
 * - mock 模式恒 open（演示不打扰，故障浮层全部不触发）
 * - 真实模式：首次启动走 DesktopInstall 引导；之后每次启动直接探测，
 *   error 时 BootFailure 浮层给重试 / 引擎设置；connecting 期间显示解码动画。
 *
 * 右栏网关状态点与故障浮层统一消费本 store（替代原先 RightToolbar 本地 ping）。
 */

import { atom } from "nanostores";
import { invoke } from "@tauri-apps/api/core";
import { MOCK } from "@/lib/mock";

export type GatewayState = "idle" | "connecting" | "open" | "error";

export const $gatewayState = atom<GatewayState>(MOCK ? "open" : "idle");
export const $gatewayError = atom<string | null>(null);

let probing = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 探活：idle/error → connecting → ping → open/error（防并发） */
export async function pingGateway(): Promise<boolean> {
  if (MOCK) {
    $gatewayState.set("open");
    $gatewayError.set(null);
    return true;
  }
  if (probing) return $gatewayState.get() === "open";
  probing = true;
  $gatewayState.set("connecting");
  $gatewayError.set(null);
  try {
    // 唯一后端 = dsh sidecar：探测 dsh_sidecar_ready（sidecar 由 Rust 启动，
    // 需片刻就绪，故短轮询重试），引擎（DeepSeek Harness）按需惰性启动。
    let ok = false;
    for (let i = 0; i < 8; i++) {
      try {
        if (await invoke<boolean>("dsh_sidecar_ready")) {
          ok = true;
          break;
        }
      } catch {
        /* sidecar 尚未注册命令，稍后重试 */
      }
      await sleep(750);
    }
    $gatewayState.set(ok ? "open" : "error");
    if (!ok) {
      $gatewayError.set("dsh sidecar 未就绪 — 请确认应用日志无 sidecar 启动错误");
    }
    return ok;
  } catch (err) {
    $gatewayState.set("error");
    $gatewayError.set(String(err));
    return false;
  } finally {
    probing = false;
  }
}
