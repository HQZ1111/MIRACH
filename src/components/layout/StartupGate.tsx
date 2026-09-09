/**
 * StartupGate — 启动门（主界面始终在背后渲染，本组件叠在上层）
 *
 * 流程语义（对齐用户要求的时序）：密码页/配置页**永不拦截引擎**——
 * 引擎由 Rust setup 自主预热（与前端渲染并行）；解锁/配置完成 → 进入
 * **启动页**（解码动画 = GatewayConnectingOverlay），在这里等引擎就绪
 * （消费 $desktopBoot 真实阶段/进度 + $gatewayState），彻底就绪才进主界面。
 */

import { useStore } from "@nanostores/react";
import {
  $startupPhase,
  lockApp,
} from "@/store/password";
import { $gatewayState } from "@/store/gateway";
import { GatewayConnectingOverlay } from "@/components/overlays/GatewayConnectingOverlay";
import { LoginPage } from "@/components/layout/LoginPage";

export function StartupGate() {
  const phase = useStore($startupPhase);
  const gatewayState = useStore($gatewayState);

  // 启动决策：启动即显示登录页（未设密码 → 设置密码模式；已设 → 解锁模式）。
  // 仅挂载时判定一次：运行时开启密码（设置页）不触发锁屏，避免设置完立刻被锁。
  lockAppOnce();

  // 放行点 = 解锁/配置完成后（splash+locked 均结束）：进入启动页等引擎。
  // gatewayState !== "open" 时显示启动页（真实就绪门），open 即进主界面。
  if (phase === "locked") return <LoginPage />;
  if (phase === "splash" || gatewayState !== "open") {
    return <GatewayConnectingOverlay />;
  }
  return null;
}

let lockDecided = false;
function lockAppOnce(): void {
  if (lockDecided) return;
  lockDecided = true;
  lockApp();
}
