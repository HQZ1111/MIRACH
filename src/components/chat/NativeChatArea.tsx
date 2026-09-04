/**
 * NativeChatArea — dsh 风格官方原生融合（官方对话根树）
 *
 * 渲染官方 'root' 槽位整树（AppFrame + sidebar/details 折叠 + conversation
 * 官方 ChatView + 官方 Composer）：与官方 web 同一个 React 上下文、同一份
 * 组件——官方更新渲染管线时本视图直接跟随。
 *
 * 会话同步：目标 mirach 会话 → sidecar session.map.get → 内核 sessions.open
 * 官方 current 会话（官方 ConversationRoot 按 current 渲染）；映射缺失
 * （该会话从未对引擎发言）时现场 bindEngineSession 建立映射。
 * 内核未 boot / 会话未映射 / 引擎不可达 → 渲染 fallback（mirach 默认对话区）。
 */

import { useEffect, useState, type ReactNode } from "react";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
import { bindEngineSession, $mainPersona } from "@/store/engine-session";
import {
  nativeCollapsePanels,
  nativeOpenSession,
  nativeRenderReady,
  nativeRootTree,
} from "@/dsh-kernel/boot";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";

const KERNEL_RETRY_MS = 1500;
const KERNEL_RETRY_MAX = 20;

export function NativeChatArea({
  sessionId,
  fallback,
}: {
  sessionId: string;
  /** 内核/映射未就绪或失败时的占位（mirach 默认对话区），就绪后整块换官方树 */
  fallback?: ReactNode;
}) {
  const [tree, setTree] = useState<ReactNode | null>(null);

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
      if (!dshId) return;
      try {
        await nativeOpenSession(dshId);
        console.debug("[nca] open ok", dshId);
      } catch (e) {
        console.debug("[nca] open threw", String(e));
        return;
      }
      if (cancelled) return;
      const t = nativeRootTree();
      console.debug("[nca] tree", t === null ? "null" : "element");
      if (t === null) return;
      // 官方三栏只剩中间对话列（mirach shell 提供侧栏）
      nativeCollapsePanels();
      setTree(t);
    };

    void tryLoad(KERNEL_RETRY_MAX);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (tree === null) return fallback ? <>{fallback}</> : null;
  return (
    <div className="dsh-native-area relative min-h-0 flex-1 overflow-hidden" style={DSW_ALIAS_VARS}>
      {tree}
    </div>
  );
}
