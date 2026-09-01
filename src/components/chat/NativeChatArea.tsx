/**
 * NativeChatArea — dsh 风格官方原生融合（官方对话根树）
 *
 * 渲染官方 'root' 槽位整树（AppFrame + sidebar/details 折叠 + conversation
 * 官方 ChatView + 官方 Composer）：与官方 web 同一个 React 上下文、同一份
 * 组件——官方更新渲染管线时本视图直接跟随。
 *
 * 会话同步：目标 mirach 会话 → sidecar session.map.get → 内核 sessions.open
 * 官方 current 会话（官方 ConversationRoot 按 current 渲染）。
 * 内核未 boot / 会话未映射 / 引擎不可达 → onReady(false)，父层回退 mirach UI。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getApi } from "@/lib/api";
import { MOCK } from "@/lib/mock";
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
  onReady,
}: {
  sessionId: string;
  onReady?: (ok: boolean) => void;
}) {
  const [tree, setTree] = useState<ReactNode | null>(null);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    let cancelled = false;
    setTree(null);
    if (MOCK) {
      onReadyRef.current?.(false);
      return;
    }

    const tryLoad = async (retriesLeft: number): Promise<void> => {
      if (cancelled) return;
      if (!nativeRenderReady()) {
        if (retriesLeft > 0) {
          window.setTimeout(() => void tryLoad(retriesLeft - 1), KERNEL_RETRY_MS);
          return;
        }
        onReadyRef.current?.(false);
        return;
      }
      // 会话映射 → 内核 current 会话同步（官方 conversation 渲染对象）
      const dshId = await getApi().getDshSessionId(sessionId);
      if (cancelled) return;
      if (!dshId) {
        onReadyRef.current?.(false);
        return;
      }
      try {
        await nativeOpenSession(dshId);
      } catch {
        if (!cancelled) onReadyRef.current?.(false);
        return;
      }
      if (cancelled) return;
      const t = nativeRootTree();
      if (t === null) {
        onReadyRef.current?.(false);
        return;
      }
      // 官方三栏只剩中间对话列（mirach shell 提供侧栏）
      nativeCollapsePanels();
      setTree(t);
      onReadyRef.current?.(true);
    };

    void tryLoad(KERNEL_RETRY_MAX);
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (tree === null) return null;
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden" style={DSW_ALIAS_VARS}>
      {tree}
    </div>
  );
}
