/**
 * StartupGate — 启动门（主界面始终在背后渲染，本组件叠在上层）
 *
 * 流程语义（对齐用户要求的时序）：密码页/配置页**永不拦截引擎**——
 * 引擎由 Rust setup 自主预热（与前端渲染并行）；解锁/配置完成 → 进入
 * **启动页**（解码动画 = GatewayConnectingOverlay），在这里等**真实就绪**：
 * ① 引擎（sidecar + dsh runtime，$gatewayState === "open"）
 * ② 官方对话内核（KERNEL_PLUGINS 激活 + ctx.sessions + 根树，$kernelReady）
 * 两者都就绪才淡入主界面。
 */

import { useStore } from "@nanostores/react";
import {
  $startupPhase,
  lockApp,
} from "@/store/password";
import { $gatewayState } from "@/store/gateway";
import { $kernelReady } from "@/store/kernel-ready";
import { GatewayConnectingOverlay } from "@/components/overlays/GatewayConnectingOverlay";
import { LoginPage } from "@/components/layout/LoginPage";

let lockDecided = false;
function lockAppOnce(): void {
  if (lockDecided) return;
  lockDecided = true;
  lockApp();
}

// 首帧即锁定（模块加载时判定，早于 React 首渲染）：否则第一帧 phase 仍是
// "unlocked" 且引擎/内核已就绪，会闪一下主页面再被启动页盖住。
// 注意：必须放在 lockDecided 声明之后（模块顶层调用踩 TDZ 会整页白屏）。
lockAppOnce();

/** 启动门是否已放行过（进入主界面后永不复活全屏遮罩——hermes 同语义：
 *  引擎掉线只更新状态点/提示，绝不把用户盖回启动页）。 */
let gatePassed = false;

export function StartupGate() {
  const phase = useStore($startupPhase);
  const gatewayState = useStore($gatewayState);
  const kernelReady = useStore($kernelReady);

  // 首次满足放行条件即记录；此后本组件永久返回 null（引擎断联不再全屏拦截）
  if (!gatePassed && phase !== "locked" && gatewayState === "open" && kernelReady) {
    gatePassed = true;
  }
  if (gatePassed) return null;

  // 放行点 = 解锁/配置完成 + 引擎就绪 + 内核就绪（三者齐备才进主界面）。
  if (phase === "locked") return <LoginPage />;
  if (phase === "splash" || gatewayState !== "open" || !kernelReady) {
    return <GatewayConnectingOverlay />;
  }
  return null;
}
