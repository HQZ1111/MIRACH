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

import { Component, useCallback, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { nativeLocaleTranslate, nativeSlotEntries } from "@/dsh-kernel/boot";
import { DSW_ALIAS_VARS } from "@/lib/dsw-tokens";

export interface OfficialEntryLike {
  id?: string;
  label?: string;
  component: unknown;
  inject?: (...args: never[]) => unknown;
  options: Record<string, unknown>;
}

/** 条目级错误边界：单条目崩溃只降级该条目（分区级复用见 SettingsOverlay） */
export class MiniBoundary extends Component<{ children: ReactNode; onError?: (msg: string) => void }, { failed: string | null }> {
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
 *  都不崩（数据面未对接时优雅降级，能渲染的项照常渲染）。
 *  单例化：每次渲染新建 Proxy 会让官方组件的 effect/memo 依赖全部失稳。
 *  原始值出口必须有：React dev 会在 commit 期序列化组件 props（devtools
 *  logComponentRender），代理无 toPrimitive 时 String(proxy) 会无限递归
 *  ToPrimitive → "Cannot convert object to primitive value" → 整个 commit
 *  被异常打断 → 之后的更新都不落盘（表现为设置页点击"没反应"）。 */
const SAFE_FACE = (() => {
  const target = function () { /* noop */ } as unknown as Record<string, unknown>;
  const proxy = new Proxy(target, {
    get: (_t, k) => {
      if (k === Symbol.toPrimitive) return () => "safe";
      if (k === "toString") return () => "safe";
      if (k === "valueOf") return () => "safe";
      if (k === "toJSON") return () => ({ safe: true });
      if (k === "Symbol(util.inspect.custom)") return () => "[safe]";
      return proxy as object;
    },
    apply: () => proxy as object,
    construct: () => proxy as object,
  }) as unknown;
  return proxy;
})();
function useStoreShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(SAFE_FACE);
}
function useSessionsShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(SAFE_FACE);
}
function useProjectionShim(_key: string): unknown {
  return SAFE_FACE;
}
function useSessionShim(_key?: unknown): unknown {
  return SAFE_FACE;
}
function usePermissionShim(_key?: unknown): unknown {
  return SAFE_FACE;
}
function useSettingsShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(SAFE_FACE);
}
function useAgentPresetShim<T>(selector?: (state: unknown) => T): T | undefined {
  return selector === undefined ? (undefined as T) : selector(SAFE_FACE);
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

/** defineStore 返回的是"工厂手柄"（create() 才是实例）——官方渲染器经
 *  storeOf 解析实例；迷你渲染器按同一语义解析并按手柄缓存实例。 */
const storeInstances = new WeakMap<object, { getSnapshot: () => unknown; subscribe: (f: () => void) => () => void }>();
function storeInstanceOf(
  handle: unknown,
): { getSnapshot: () => unknown; subscribe: (f: () => void) => () => void } | undefined {
  if (handle === null || typeof handle !== "object") return undefined;
  const cached = storeInstances.get(handle as object);
  if (cached !== undefined) return cached;
  const h = handle as { create?: () => unknown; getSnapshot?: () => unknown; subscribe?: (f: () => void) => () => void };
  let inst: unknown;
  try {
    inst = typeof h.create === "function" ? h.create() : h;
  } catch {
    return undefined;
  }
  const instAny = inst as { getSnapshot?: () => unknown; subscribe?: (f: () => void) => () => void };
  if (typeof instAny.getSnapshot !== "function") return undefined;
  if (typeof instAny.subscribe !== "function") return undefined;
  const resolved = {
    getSnapshot: () => instAny.getSnapshot!(),
    subscribe: instAny.subscribe as (f: () => void) => () => void,
  };
  storeInstances.set(handle as object, resolved);
  return resolved;
}

/** 官方 inject 的 `hooks` 可观察源 → `use<Name>` hook（官方 renderer 的
 *  standardHookPropName 语义）。快照做内容稳定化（防 uSES 无限循环）。 */
function observableHook(source: { getSnapshot: () => unknown; subscribe: (f: () => void) => () => void }): (selector?: (v: unknown) => unknown) => unknown {
  // 每个源一个缓存器（模块级 WeakMap 无法覆盖裸对象 → 闭包外挂在源上）
  const cache = { v: null as unknown };
  return function useObservableSourceHook(selector?: (v: unknown) => unknown): unknown {
    const snap = useSyncExternalStore(
      source.subscribe,
      () => {
        const v = source.getSnapshot();
        const prev = cache.v;
        if (prev !== null && Object.is(prev, v)) return prev;
        if (prev !== null && typeof v === "object" && v !== null && JSON.stringify(prev) === JSON.stringify(v)) return prev;
        cache.v = v;
        return v;
      },
      () => undefined,
    );
    return selector === undefined ? snap : selector(snap);
  };
}

/** 构建 inject 面：hooks 段绑定成 use<Name>（与官方 bindInjectHooks 等价） */
function bindInjectedHooks(face: Record<string, unknown>): Record<string, unknown> {
  const hooks = face["hooks"];
  if (hooks === null || typeof hooks !== "object") return face;
  const { hooks: _h, ...rest } = face;
  const out: Record<string, unknown> = { ...rest };
  for (const [name, source] of Object.entries(hooks as Record<string, unknown>)) {
    const src = source as { getSnapshot?: unknown; subscribe?: unknown };
    if (typeof src?.getSnapshot !== "function" || typeof src?.subscribe !== "function") continue;
    const hookName = `use${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`;
    out[hookName] = observableHook(src as { getSnapshot: () => unknown; subscribe: (f: () => void) => () => void });
  }
  return out;
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
      const face = typeof entry.inject === "function" ? (entry.inject() as Record<string, unknown>) : {};
      // hooks 段（tabs/agentPresetSection…）绑定成 use<Name> 真实订阅 hook
      return bindInjectedHooks(face);
    } catch {
      return {};
    }
  }, [entry]);
  // 官方条目声明的 store（defineStore 工厂手柄 → 实例解析并缓存；如 ui-theme
  // 的主题/字号快照、locale 语言快照）：useStore 订阅真实数据。
  // 快照内容稳定化：store 实例的 getSnapshot 可能每次返回新对象（引用不等），
  // 直接塞进 useSyncExternalStore 会触发 "Maximum update depth exceeded" 死循环。
  const storeHandle = useMemo(() => storeInstanceOf(entry.options.store), [entry]);
  const snapRef = useRef<{ v: unknown } | null>(null);
  const getStableSnapshot = useCallback(() => {
    const v = storeHandle?.getSnapshot?.();
    const prev = snapRef.current?.v;
    if (prev !== undefined && Object.is(prev, v)) return prev;
    if (prev !== undefined && typeof v === "object" && v !== null && JSON.stringify(prev) === JSON.stringify(v)) {
      return prev;
    }
    snapRef.current = { v };
    return v;
  }, [storeHandle]);
  const snapshot = useSyncExternalStore(
    (cb: () => void) => (typeof storeHandle?.subscribe === "function" ? storeHandle.subscribe(cb) : () => {}),
    getStableSnapshot,
    () => undefined,
  );
  const useStorePassed = useMemo(
    () =>
      ((selector?: (state: unknown) => unknown) =>
        selector === undefined ? snapshot : selector(snapshot)) as typeof useStoreShim,
    [snapshot],
  );
  if (typeof Comp !== "function") return null;
  const isStoreless = storeHandle === undefined;
  // 官方行组件（LanguageRow 等）内部使用内联箭头（onClose 等）——官方 web 里
  // 行组件不会反复重渲染（官方渲染器有稳定的标准 props + memo 节奏），而
  // 迷你渲染器下 SlotRow 每次父渲染都会重建 props 对象 → 行组件跟着重渲染 →
  // 新箭头 → Menu 等官方原语的 effect 依赖永远变化 → "Maximum update depth
  // exceeded" 死循环。把官方元素按 [Comp, injected, t, snapshot] memo 化，
  // 让官方行组件只在其输入变化时重渲染，箭头引用随之稳定。
  const row = useMemo(
    () => (
      <Comp
        {...injected}
        t={t}
        owner={owner}
        renderSlot={(childKey: string, childOwner: object, opts?: { only?: string }) => (
          <SlotList slotKey={childKey} owner={childOwner ?? owner} only={opts?.only} />
        )}
        useStore={isStoreless ? useStoreShim : useStorePassed}
        useSessions={useSessionsShim}
        useSession={useSessionShim}
        useProjection={useProjectionShim}
        usePermission={usePermissionShim}
        useSettings={useSettingsShim}
        useAgentPreset={useAgentPresetShim}
      />
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Comp, injected, t, owner, isStoreless, snapshot],
  );
  return <MiniBoundary>{row}</MiniBoundary>;
}

/** 官方条目完整渲染（分区或酒馆面板；entry.section 级） */
export function OfficialEntry({
  entry,
  onClose,
}: {
  entry: OfficialEntryLike;
  onClose?: () => void;
}) {
  // owner 必须稳定（SlotRow 的 row memo 依赖它）
  const owner = useMemo(() => ({ close: onClose }), [onClose]);
  return (
    <div data-official-entry style={DSW_ALIAS_VARS}>
      <SlotRow entry={entry} owner={owner} />
    </div>
  );
}
