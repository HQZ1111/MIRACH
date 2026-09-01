/**
 * OfficialContent — 官方设置内容渲染（mirach 壳 + 官方组件 + mirach 令牌）
 *
 * 官方条目（StoredEntry）没有可直调的 render()（"official.render is not a
 * function" 实证）——官方 renderer 的条目渲染管线只有官方 Shell 能用。
 * 本组件实现官方 renderer 的迷你版：
 *   - entry = { component, options, inject }（来自 slots.entriesOfSlot）
 *   - 标准 props 由包裹组件（SlotHost）在组件内提供（hooks 在组件内调用，
 *     满足 React 规则）：useStore/useSessions/useProjection 先给最小实现，
 *     未消费面不会被调用；t = 官方词典（nativeLocaleTranslate）
 *   - renderSlot shim：按 key 递归渲染子槽条目（entriesOfSlot 逐个 SlotRow）；
 *     条目/子树各自包 MiniBoundary——单条目崩溃只降级该条目，不影响页面
 * 视觉：宿主容器挂 DSW_ALIAS_VARS（mirach 令牌）——官方组件用官方令牌色
 * 渲染，正是"官方组件 + 我们软件的令牌 ui"。
 */

import { Component, useMemo, type ReactNode } from "react";
import { nativeLocaleTranslate, nativeSlotEntries } from "@/dsh-kernel/boot";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";

export interface OfficialEntryLike {
  id?: string;
  label?: string;
  component: unknown;
  inject?: (...args: never[]) => unknown;
  options: Record<string, unknown>;
}

/** 条目级错误边界：单条目崩溃只降级该条目 */
class MiniBoundary extends Component<{ children: ReactNode; onError?: (msg: string) => void }, { failed: string | null }> {
  state: { failed: string | null } = { failed: null };
  static getDerivedStateFromError(err: unknown) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
  componentDidCatch(err: unknown) {
    try { this.props.onError?.(err instanceof Error ? err.message : String(err)); } catch { /* ignore */ }
    console.warn("[official] entry crashed:", err instanceof Error ? err.message : err);
  }
  render() {
    if (this.state.failed !== null) {
      return (
        <p className="px-1 py-2 text-[11px] leading-relaxed text-muted-foreground">
          官方项暂不可用（组件绑定缺失）：{this.state.failed.slice(0, 80)}
        </p>
      );
    }
    return this.props.children;
  }
}

/** 标准 hooks 的最小实现（真实 React hooks，组件内调用）。
 *  安全面：返回递归 safe proxy——官方组件读取任意字段/调用任意方法
 *  都不崩（数据面未对接时优雅降级，能渲染的项照常渲染）。 */
function safeFace(): unknown {
  const target = function () { /* noop */ } as unknown as Record<string, unknown>;
  const proxy = new Proxy(target, {
    get: () => proxy as object,
    apply: () => proxy as object,
    construct: () => proxy as object,
  }) as unknown;
  return proxy;
}
function useStoreShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(safeFace());
}
function useSessionsShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(safeFace());
}
function useProjectionShim(_key: string): unknown {
  return safeFace();
}
function useSessionShim(_key?: unknown): unknown {
  return safeFace();
}
function usePermissionShim(_key?: unknown): unknown {
  return safeFace();
}
function useSettingsShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(safeFace());
}

/** 子槽渲染（key → 条目列表 → SlotRow） */
function SlotList({ slotKey, only, owner }: { slotKey: string; only?: string; owner: object }) {
  const entries = nativeSlotEntries(slotKey);
  const list = only === undefined ? entries : entries.filter((e) => e.id === only);
  return (
    <>
      {list.map((e, i) => (
        <SlotRow key={`${e.id ?? slotKey}-${i}`} entry={e} owner={owner} />
      ))}
    </>
  );
}

/** 单一条目渲染（标准 props 装配 + 边界） */
function SlotRow({ entry, owner }: { entry: OfficialEntryLike; owner: object }) {
  const Comp = entry.component as
    | ((props: Record<string, unknown>) => ReactNode)
    | undefined;
  const t = useMemo(
    () =>
      nativeLocaleTranslate(typeof entry.options.locale === "string" ? entry.options.locale : "settings") ??
      ((key: string) => key),
    [entry],
  );
  const injected = useMemo(() => {
    try {
      return typeof entry.inject === "function" ? (entry.inject() as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }, [entry]);
  if (typeof Comp !== "function") return null;
  return (
    <MiniBoundary>
      <Comp
        {...injected}
        t={t}
        owner={owner}
        renderSlot={(childKey: string, childOwner: object, opts?: { only?: string }) => (
          <SlotList slotKey={childKey} owner={childOwner ?? owner} only={opts?.only} />
        )}
        useStore={useStoreShim}
        useSessions={useSessionsShim}
        useSession={useSessionShim}
        useProjection={useProjectionShim}
        usePermission={usePermissionShim}
        useSettings={useSettingsShim}
      />
    </MiniBoundary>
  );
}

/** 官方条目完整渲染（分区或酒馆面板；entry.section 级） */
export function OfficialEntry({
  entry,
  onClose,
}: {
  entry: OfficialEntryLike;
  onClose?: () => void;
}) {
  return (
    <div data-official-entry style={DSW_ALIAS_VARS}>
      <SlotRow entry={entry} owner={{ close: onClose }} />
    </div>
  );
}
