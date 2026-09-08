/**
 * StartupGate — 启动门（主界面始终在背后渲染，本组件叠在上层）
 *
 * - 启动始终显示登录页（主界面在其背后渲染）：
 *   未设密码 → 登录页「设置密码」模式；已设密码 → 「解锁」模式。
 * - 输对密码淡出无缝进入主页。
 *
 * 登录页本体抽到 LoginPage.tsx（独立预览走 main.tsx `?win=login`）。
 *
 * SplashGate：连接动画接 $desktopBoot（hermes boot 状态机）——进度条是
 * 真实启动阶段（sidecar → 引擎预热 → 就绪），不再是定时假进度；
 * 引擎就绪（gateway open）即淡出，boot 失败显示错误（BootFailureOverlay
 * 在 AppLayout 的 ready 后路径另有承接，这里显示 boot.error 兜底）。
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  $startupPhase,
  lockApp,
  unlockApp,
} from "@/store/password";
import { $gatewayState } from "@/store/gateway";
import { $desktopBoot } from "@/store/boot";
import { GatewayConnectingOverlay } from "@/components/overlays/GatewayConnectingOverlay";
import { LoginPage } from "@/components/layout/LoginPage";

export function StartupGate() {
  const phase = useStore($startupPhase);

  // 启动决策：启动即显示登录页（未设密码 → 设置密码模式；已设 → 解锁模式）。
  // useLayoutEffect 在首次绘制前锁定，避免闪现启动动画；
  // 仅挂载时判定一次：运行时开启密码（设置页）不触发锁屏，避免设置完立刻被锁。
  useLayoutEffect(() => {
    lockApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "splash") return <SplashGate />;
  if (phase === "locked") return <LoginPage />;
  return null;
}

// ----------------------------------------------------------------
// 连接动画（密码关闭时的启动过渡；进度 = 真实 boot 阶段）
// ----------------------------------------------------------------

function SplashGate() {
  const [opacity, setOpacity] = useState(1);
  const boot = useStore($desktopBoot);
  const gatewayState = useStore($gatewayState);

  // 引擎就绪 → 淡出进主页（对齐 hermes：就绪才揭示，不等固定时长）
  useEffect(() => {
    if (gatewayState !== "open") return;
    const t = window.setTimeout(() => {
      setOpacity(0);
      window.setTimeout(unlockApp, 400); // 淡出后进入主页
    }, 400);
    return () => window.clearTimeout(t);
  }, [gatewayState]);

  return (
    <div className="absolute inset-0 z-[90] transition-opacity duration-300" style={{ opacity }}>
      <GatewayConnectingOverlay />
      {boot.error && (
        <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[91] flex flex-col items-center">
          <p className="max-w-[420px] text-center text-[11px] leading-relaxed text-[#EF4444]">{boot.error}</p>
        </div>
      )}
    </div>
  );
}
