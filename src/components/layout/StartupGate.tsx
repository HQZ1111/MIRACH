/**
 * StartupGate — 启动门（主界面始终在背后渲染，本组件叠在上层）
 *
 * - 启动始终显示登录页（主界面在其背后渲染）：
 *   未设密码 → 登录页「设置密码」模式；已设密码 → 「解锁」模式。
 * - 输对密码淡出无缝进入主页。
 *
 * 登录页本体抽到 LoginPage.tsx（独立预览走 main.tsx `?win=login`）。
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { useStore } from "@nanostores/react";
import {
  $startupPhase,
  lockApp,
  unlockApp,
} from "@/store/password";
import { GatewayConnectingOverlay } from "@/components/overlays/GatewayConnectingOverlay";
import { LoginPage } from "@/components/layout/LoginPage";

const SPLASH_MS = 1800;

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
// 连接动画（密码关闭时的启动过渡）
// ----------------------------------------------------------------

function SplashGate() {
  const [progress, setProgress] = useState(0);
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    const t = window.setInterval(() => setProgress((p) => Math.min(100, p + 4)), 60);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setOpacity(0);
      window.setTimeout(unlockApp, 400); // 淡出后进入主页
    }, SPLASH_MS);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="absolute inset-0 z-[90] transition-opacity duration-300" style={{ opacity }}>
      <GatewayConnectingOverlay />
      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-[91] flex flex-col items-center">
        <div className="h-1 w-64 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-[#6366F1] transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-2 text-[11px] tabular-nums text-muted-foreground">
          正在准备 Mirach… {progress}%
        </p>
      </div>
    </div>
  );
}
