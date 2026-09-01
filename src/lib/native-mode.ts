/**
 * native-mode — 官方模式切换接线（计划模式 / 权限预设）
 *
 * 状态 = 活跃会话 plan/mode 投影事件（官方 plan-mode 包的折叠语义：
 *        最后一条生效，无则关闭）；权限预设无投影事件透传，按会话乐观记录。
 * 切换 = 官方 commands.execute（/plan on|off、/permission <preset>）——
 *        与官方 composer 输入斜杠命令同管线（sidecar 映射前端会话 id → dsh id）。
 * 预设清单 = 官方 settings.describe（permission 命名空间 defaultPreset 枚举
 *        + 官方 presentation.ts 的 FULL_ACCESS_PRESET 机器值）。
 */

import { atom, computed } from "nanostores";
import { getApi } from "@/lib/api";
import { $activeSessionId } from "@/store/session";
import { $rawEvents } from "@/store/session-events";

/** 官方 ui-permission-presets presentation.ts 的机器值：完全访问预设 */
export const FULL_ACCESS_PRESET = "danger-full-access";

/** 官方权限预设（settings.describe 的 defaultPreset 枚举项） */
export interface NativePermissionPreset {
  id: string;
  label: string;
}

// ── 计划模式 ────────────────────────────────────────────────────────────────

/** 活跃会话的 plan/mode 投影（官方折叠：最后一条生效；无事件 = 关闭） */
const $projectedPlan = computed([$rawEvents, $activeSessionId], (events, sid) => {
  if (!sid) return false;
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === "plan/mode") {
      const d = ev.data as { active?: boolean } | null;
      return d?.active === true;
    }
  }
  return false;
});

/** 计划模式是否激活（官方投影 > 乐观切换） */
const $optimisticPlan = atom<boolean | null>(null);
export const $planActive = computed([$projectedPlan, $optimisticPlan], (projected, optimistic) =>
  optimistic !== null ? optimistic : projected,
);

// 乐观值只在切换 → 事件确认的窗口内有效；换会话即清
let boundPlanSid: string | null = null;
$activeSessionId.subscribe((sid) => {
  if (sid !== boundPlanSid) {
    boundPlanSid = sid;
    $optimisticPlan.set(null);
  }
});

// ── 权限预设 ────────────────────────────────────────────────────────────────

/** 官方权限预设清单（settings.describe 解析；null = 不可用） */
const $presets = atom<NativePermissionPreset[] | null>(null);
/** 新会话默认预设（官方 defaultPreset 值；/workspace 模式还原目标） */
const $defaultPreset = atom<string>("");
/** 活跃会话的权限预设（乐观记录；官方无投影事件透传） */
const $sessionPreset = atom<string>("");

/** 预设清单（模式菜单展示用；null = 内核/引擎不可用） */
export const $nativePresets = computed($presets, (p) => p);
/** 新会话默认预设（workspace 模式还原目标） */
export const $nativeDefaultPreset = computed($defaultPreset, (v) => v);

/** 官方模式应用（模式菜单三项 → 官方命令组合）；sidOverride 供成员会话上下文 */
export async function applyNativeMode(m: "plan" | "workspace" | "full", sidOverride?: string): Promise<boolean> {
  if (m === "plan") return setNativePlan(true, sidOverride);
  if (m === "full") {
    await setNativePlan(false, sidOverride);
    return setNativePermissionPreset(FULL_ACCESS_PRESET, sidOverride);
  }
  // workspace（标准）：退计划 + 权限还原为新会话默认预设
  await setNativePlan(false, sidOverride);
  const def = $defaultPreset.get();
  if (def && def !== FULL_ACCESS_PRESET) return setNativePermissionPreset(def, sidOverride);
  return true;
}

export const $permissionPreset = computed(
  [$presets, $defaultPreset, $sessionPreset],
  (presets, fallbackDefault, sessionPreset) => sessionPreset || fallbackDefault || (presets?.[0]?.id ?? ""),
);

/** 拉取官方权限预设（settings.describe → permission.defaultPreset 枚举） */
export async function loadNativePermissionPresets(): Promise<void> {
  if ($presets.get() !== null) return;
  try {
    const raw = await getApi().describeSettings();
    if (!raw) return;
    const ns = (raw.namespaces ?? []).find((n) => n?.ns === "permission");
    if (!ns) return;
    // defaultPreset 当前值（新会话默认）
    const value = (ns.value as { defaultPreset?: unknown } | null)?.defaultPreset;
    if (typeof value === "string") $defaultPreset.set(value);
    // schema 里 defaultPreset 字段的 const 枚举 = 可选预设
    const choices = collectConstChoices(ns.schema, "defaultPreset");
    if (choices.length > 0) {
      $presets.set(choices.map((c) => ({
        id: c,
        label: c === FULL_ACCESS_PRESET ? "Full access" : c.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
      })));
    }
  } catch {
    /* 预设清单不可用：模式菜单回退隐藏权限切换 */
  }
}

/** 递归收集 schema JSON 里 defaultPreset 字段下的 const 选项（官方 union of const 形态） */
function collectConstChoices(schema: unknown, field: string, depth = 0): string[] {
  if (depth > 12 || schema === null || typeof schema !== "object") return [];
  const out: string[] = [];
  if (Array.isArray(schema)) {
    for (const item of schema) out.push(...collectConstChoices(item, field, depth + 1));
    return out;
  }
  const obj = schema as Record<string, unknown>;
  for (const [k, v] of Object.entries(obj)) {
    if (k === field) {
      // defaultPreset 节点：自身是 const 或 union 列表
      out.push(...collectPresetNode(v, depth + 1));
    } else {
      out.push(...collectConstChoices(v, field, depth + 1));
    }
  }
  return [...new Set(out)];
}

function collectPresetNode(node: unknown, depth: number): string[] {
  if (depth > 6 || node === null || typeof node !== "object") return [];
  const obj = node as Record<string, unknown>;
  if (obj.type === "const" && typeof obj.value === "string") return [obj.value];
  if (obj.type === "union" && Array.isArray(obj.list)) {
    return obj.list.flatMap((n) => collectPresetNode(n, depth + 1));
  }
  // 序列化形态未知时退化为全树 const 收集
  const out: string[] = [];
  for (const v of Object.values(obj)) out.push(...collectPresetNode(v, depth + 1));
  return out;
}

// ── 切换动作（官方命令执行） ────────────────────────────────────────────────

/** 进入/退出计划模式（官方 /plan on|off）；sidOverride 供成员会话上下文 */
export async function setNativePlan(on: boolean, sidOverride?: string): Promise<boolean> {
  const sid = sidOverride ?? $activeSessionId.get();
  if (!sid) return false;
  const ok = await getApi().nativeExecuteCommand(sid, on ? "/plan on" : "/plan off");
  if (ok) $optimisticPlan.set(on);
  return ok;
}

/** 切换会话权限预设（官方 /permission <preset>）；sidOverride 供成员会话上下文 */
export async function setNativePermissionPreset(preset: string, sidOverride?: string): Promise<boolean> {
  const sid = sidOverride ?? $activeSessionId.get();
  if (!sid || !preset) return false;
  const ok = await getApi().nativeExecuteCommand(sid, `/permission ${preset}`);
  if (ok) $sessionPreset.set(preset);
  return ok;
}

/** 供 Composer 预热预设清单（模式菜单打开前拉一次） */
export function warmNativeModes(): void {
  void loadNativePermissionPresets();
}
