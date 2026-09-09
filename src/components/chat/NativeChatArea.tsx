/**
 * NativeChatArea — dsh 风格官方原生融合（官方对话根树）
 *
 * 渲染官方 'root' 槽位整树（AppFrame + sidebar 列=mirach 侧栏外壳 + details
 * 折叠 + conversation 官方 ChatView + 官方 Composer）：与官方 web 同一个
 * React 上下文、同一份组件——官方更新渲染管线时本视图直接跟随。
 *
 * 会话同步：目标 mirach 会话 → sidecar session.map.get → 内核 sessions.open
 * 官方 current 会话（官方 ConversationRoot 按 current 渲染）；映射缺失
 * （该会话从未对引擎发言）时现场 bindEngineSession 建立映射。
 * 内核未 boot / 会话未映射 / 引擎不可达 → 渲染轻量加载占位（唯一对话区是官方树）。
 */

import { Component, useEffect, useState, type ReactNode } from "react";
import { useStore } from "@nanostores/react";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { bindEngineSession, $mainPersona } from "@/store/engine-session";
import { $gatewayState } from "@/store/gateway";
import { $kernelConnection } from "@/store/kernel-connection";
import { $kernelReady } from "@/store/kernel-ready";
import {
  nativeCollapsePanels,
  nativeOpenSession,
  nativeRenderReady,
  nativeRootTree,
} from "@/dsh-kernel/boot";
import { ComposerRowAdaptive, MirachAutoGlyph, OfficialVoiceSend } from "@/dsh-kernel/composer-extras";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";

const KERNEL_RETRY_MS = 1500;
const KERNEL_RETRY_MAX = 20;

/** 官方可见树错误边界：官方组件渲染崩溃时显示占位而非卸载整个应用
 *  （对齐 KernelMirrorHost 的 KernelBoundary——可见树同样需要隔离） */
class TreeBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[nca] official tree crashed:", err);
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-[#303030]/75">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#EF4444]" />
            DeepSeek Harness
          </div>
          <p className="text-[11px] text-muted-foreground/60">官方对话组件渲染异常（详见控制台）</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function NativeChatArea({
  sessionId,
}: {
  sessionId: string;
}) {
  const [tree, setTree] = useState<ReactNode | null>(null);

  const gatewayState = useStore($gatewayState);
  const kernelConnection = useStore($kernelConnection);
  // 内核就绪信号进依赖：内核 boot 现在会先等引擎冷启动（可达数分钟），
  // 固定 30s 重试预算会先耗尽并放弃挂载官方树——就绪翻转时重跑一次。
  // （连接 open 后对齐 current 会话由 boot.nativeOpenSession 自己补，见该函数）
  const kernelReady = useStore($kernelReady);
  // 链路可用 = 引擎就绪 + 内核就绪 + 内核真实连接 open（三者齐备才无横幅）
  const linkDown = !MOCK && (gatewayState !== "open" || kernelConnection !== "open");
  useEffect(() => {
    let cancelled = false;
    setTree(null);
    if (MOCK) return;

    const tryLoad = async (retriesLeft: number): Promise<void> => {
      if (cancelled) return;
      if (!nativeRenderReady()) {
        console.debug("[nca] render not ready, retries left", retriesLeft);
        if (retriesLeft > 0) {
          window.setTimeout(() => void tryLoad(retriesLeft - 1), KERNEL_RETRY_MS);
          return;
        }
        console.debug("[nca] give up: render never ready");
        return;
      }
      // 会话映射 → 内核 current 会话同步（官方 conversation 渲染对象）。
      // 映射缺失（该前端会话从未对引擎发言）时现场绑定一次：
      // set_env(环境+persona) + load_session 建立 session-map，之后官方树
      // 与 mirach 管道读写同一个 dsh 会话。
      let dshId = await getApi().getDshSessionId(sessionId);
      console.debug("[nca] mapped dshId", dshId);
      if (cancelled) return;
      if (!dshId) {
        try {
          dshId = await bindEngineSession(sessionId, $mainPersona.get());
          console.debug("[nca] bind result", dshId);
        } catch (e) {
          console.debug("[nca] bind threw", String(e));
          dshId = null;
        }
        if (cancelled) return;
      }
      // 映射缺失（浏览器 env / 引擎不可达）不阻塞渲染：官方树照常挂载
      // （侧栏列 = mirach 侧栏外壳可交互），会话同步待映射就绪时再对齐。
      if (dshId) {
        try {
          await nativeOpenSession(dshId);
          console.debug("[nca] open ok", dshId);
        } catch (e) {
          console.debug("[nca] open threw", String(e));
        }
      }
      if (cancelled) return;
      const t = nativeRootTree();
      console.debug("[nca] tree", t === null ? "null" : "element");
      if (t === null) return;
      // 官方三栏：侧栏列保留展开（渲染 mirach 侧栏外壳），details 列折叠（mirach 不用）
      nativeCollapsePanels();
      setTree(t);
    };

    void tryLoad(KERNEL_RETRY_MAX);
    return () => {
      cancelled = true;
    };
  }, [sessionId, kernelReady]);

  // 官方根树是唯一对话区：内核/映射未就绪时给轻量加载占位（不做自建对话区回退）
  if (tree === null) {
    return (
      <div className="dsh-native-area relative min-h-0 flex-1 overflow-hidden" style={DSW_ALIAS_VARS}>
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <div className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-[#303030]/75">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#6366F1]" />
            DeepSeek Harness
          </div>
          <p className="text-[11px] text-muted-foreground/60">正在连接官方对话内核…</p>
        </div>
      </div>
    );
  }
  return (
    <div className="dsh-native-area relative min-h-0 flex-1 overflow-hidden" style={DSW_ALIAS_VARS}>
      {/* 引擎/内核断联横幅：官方树照常可交互，只在顶部提示连接状态
          （不遮挡不拦截）。判定用内核真实连接（ctx.connection.state），
          不看 sidecar 就绪标志——冷启动期后者会假阳性。 */}
      {linkDown && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center pt-2">
          <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-[#F59E0B]/40 bg-[#FEF3C7]/95 px-3 py-1 text-[12px] text-[#92400E] shadow-sm">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#F59E0B]" />
            {kernelConnection === "connecting" ? "引擎连接中…" : "引擎未连接 — 界面可继续浏览，正在自动重连"}
          </div>
        </div>
      )}
      <TreeBoundary>
        {tree}
        {/* 空输入点击发送=语音（覆盖层；官方源码零改动，见 composer-extras） */}
        <OfficialVoiceSend />
        {/* 工具行自适应折叠：模型→图标 → 模式→图标 → 省略兜底（永不折行） */}
        <ComposerRowAdaptive />
        {/* mirach-auto 图标：触发钮 CSS + 菜单行注入（官方无字形） */}
        <MirachAutoGlyph />
      </TreeBoundary>
    </div>
  );
}
