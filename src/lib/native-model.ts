/**
 * native-model — 官方模型目录接线（Composer 模型 seat 的注入席位）
 *
 * 目录数据  = 官方 session.modelCatalog RPC（引擎真实可路由模型，按提供商分组，
 *            含各提供商加载失败信息）——与官方 /model 弹出选择同一数据源；
 * 当前选型  = 活跃会话事件流的 model/selection（官方持久投影事件，最后一条生效）
 *            → 乐观更新（select 成功即刻生效）→ 兜底 catalog.default（官方
 *            "未配置会话默认"语义）；
 * 选型提交  = 官方 session.selectModel RPC（sidecar 通用映射：前端会话 id → dsh id）。
 *
 * store 形态对齐官方 ModelDirectoryState（ui-model-selection/client 的
 * directory store）：官方 ModelSelect 组件（模型 + 思考档位两级菜单）直接消费。
 * 内核未 boot（mock / VITE_KERNEL=0）时 Composer 回退 mirach 自有模型菜单。
 */

import { atom, computed } from "nanostores";
import { getApi, type NativeModelCatalog } from "@/lib/api";
import { $activeSessionId } from "@/store/session";
import { $rawEvents } from "@/store/session-events";

/** 官方选型三元组（dsh-api-session-controller/types 的 ModelSelection） */
export interface NativeModelSelection {
  provider: string;
  model: string;
  reasoningEffort?: string;
}

/** 官方 ModelDirectoryState（ui-model-selection ModelSelect 消费的快照形状） */
export interface NativeModelDirectoryState {
  status: "idle" | "loading" | "ready" | "selecting";
  error: string | null;
  current: NativeModelSelection | null;
  groups: NativeModelCatalog["groups"];
  failures: NativeModelCatalog["failures"];
}

/** 官方目录（session.modelCatalog 结果；null = 尚未加载/加载失败） */
const $catalog = atom<NativeModelCatalog | null>(null);
const $catalogError = atom<string | null>(null);
/** selectModel 提交中（官方 status: 'selecting' → 菜单禁用） */
const $selecting = atom(false);
/** 乐观选型：select 成功即刻生效；真实 model/selection 事件到达后自动失效 */
const $optimistic = atom<NativeModelSelection | null>(null);

/** 活跃会话的最后一条 model/selection 投影事件（官方折叠语义：最后一条生效） */
const $projected = computed([$rawEvents, $activeSessionId], (events, sid) => {
  if (!sid) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "model/selection") {
      const d = ev.data as Partial<NativeModelSelection> | null;
      if (d && typeof d.provider === "string" && typeof d.model === "string") {
        return { provider: d.provider, model: d.model, ...(typeof d.reasoningEffort === "string" ? { reasoningEffort: d.reasoningEffort } : {}) } as NativeModelSelection;
      }
      return null;
    }
  }
  return null;
});

/** 目录快照（官方 ModelSelect 直接消费；形状与官方 directory store 一致） */
export const $modelDirectory = computed(
  [$catalog, $catalogError, $projected, $optimistic, $selecting],
  (cat, catErr, projected, optimistic, selecting): NativeModelDirectoryState => {
    // 投影事件（引擎持久事实）> 乐观值（提交未确认）> 目录默认（官方语义）
    const current = projected ?? optimistic ?? (cat ? { ...cat.default } : null);
    return {
      status: cat === null ? (catErr ? "ready" : "loading") : selecting ? "selecting" : "ready",
      error: catErr,
      current,
      groups: cat?.groups ?? [],
      failures: cat?.failures ?? [],
    };
  },
);

// 乐观值只在"提交成功 → 事件确认"的窗口内有效；切换会话必须清掉，
// 否则 A 会话的乐观选型会污染 B 会话的兜底显示
let boundSidForOptimistic: string | null = null;
$activeSessionId.subscribe((sid) => {
  if (sid !== boundSidForOptimistic) {
    boundSidForOptimistic = sid;
    $optimistic.set(null);
  }
});

/** 拉取官方目录（session.modelCatalog；失败写 error 供菜单内重试条） */
export async function loadNativeModelCatalog(): Promise<void> {
  if ($catalog.get() !== null && $catalogError.get() === null) return; // 已加载
  try {
    const cat = await getApi().getNativeModelCatalog();
    if (cat) {
      $catalog.set(cat);
      $catalogError.set(null);
    } else {
      $catalogError.set("引擎目录暂不可用");
    }
  } catch (err) {
    $catalogError.set(err instanceof Error ? err.message : String(err));
  }
}

/** 官方选型提交（session.selectModel；成功即刻乐观生效，事件随后确认）。
 *  sidOverride：成员会话等非 $activeSessionId 上下文的目标会话 id。 */
export async function selectNativeModel(selection: NativeModelSelection, sidOverride?: string): Promise<boolean> {
  const sid = sidOverride ?? $activeSessionId.get();
  if (!sid) return false;
  $selecting.set(true);
  try {
    const ok = await getApi().nativeSelectModel(
      sid,
      selection.provider,
      selection.model,
      selection.reasoningEffort,
    );
    if (ok) $optimistic.set({ ...selection });
    return ok;
  } finally {
    $selecting.set(false);
  }
}

/** 官方 ModelSelect 组件的 directory 席位（getSnapshot/subscribe 形态） */
export function modelDirectoryStore(): {
  getSnapshot: () => NativeModelDirectoryState;
  subscribe: (fn: () => void) => () => void;
} {
  return {
    getSnapshot: () => $modelDirectory.get(),
    subscribe: (fn: () => void) => $modelDirectory.listen(fn),
  };
}
