/**
 * keybinds — 兼容垫片（设置页 Keybinds 表的旧 API 面）
 *
 * 引擎已整库升级为 hermes 桌面端体系（lib/keybinds/combo.ts 的 IME 守卫
 * 组合键解析 + store/keybinds.ts 的数组绑定/冲突/捕获 + hooks/useKeybinds
 * 全局分发）。本文件把旧的单 combo API（SettingsOverlay 消费）映射到新
 * store：KEYBIND_ACTIONS → 新动作目录，bindings/setBinding/ownerOf →
 * bindingsFor/setBinding/conflictsFor。
 * 旧存储键 mirach.keybinds.v1 弃用（用户自定义重绑需在新体系重新设置）。
 */

import { comboFromEvent } from "@/lib/keybinds/combo";
import {
  allKeybindActions,
  KEYBIND_READONLY,
  type KeybindCategory,
} from "@/lib/keybinds/actions";
import {
  bindingsFor,
  resetAllBindings as resetAllBindingsNew,
  setBinding as setBindingNew,
  conflictsFor,
} from "@/store/keybinds";

export { comboFromEvent };

export interface KeybindAction {
  id: string;
  label: string;
  group: string;
  defaultCombo: string;
  /** 固定动作（Enter/Shift+Enter 等文本区原生行为），仅展示不可重绑 */
  fixed?: boolean;
}

const GROUP_ZH: Record<KeybindCategory, string> = {
  composer: "输入框",
  session: "会话",
  navigation: "导航",
  view: "视图",
};

/** 新目录的展示行（重绑定动作 + 只读固定行），与 hermes 面板同构 */
export const KEYBIND_ACTIONS: KeybindAction[] = [
  ...allKeybindActions().map(
    (a): KeybindAction => ({
      id: a.id,
      label: a.label ?? a.id,
      group: GROUP_ZH[a.category],
      defaultCombo: a.defaults[0] ?? "",
    }),
  ),
  ...KEYBIND_READONLY.map(
    (r): KeybindAction => ({
      id: r.id,
      label: r.id,
      group: GROUP_ZH[r.category],
      defaultCombo: r.keys[0] ?? "",
      fixed: true,
    }),
  ),
];

/** 当前生效绑定（主 combo；新引擎每动作支持多组合，此处取第一个） */
export function bindings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of allKeybindActions()) {
    out[a.id] = bindingsFor(a.id)[0] ?? "";
  }
  return out;
}

/** 重绑一个动作（新引擎存数组；冲突提示仍由 ownerOf/conflictsFor 提供） */
export function setBinding(actionId: string, combo: string): string {
  setBindingNew(actionId, [combo]);
  return combo;
}

export function resetAllBindings(): void {
  resetAllBindingsNew();
}

/** 查询某 combo 已被哪个动作占用（用于冲突提示；返回动作 id 或 null） */
export function ownerOf(combo: string, exceptId?: string): string | null {
  const conflicts = conflictsFor(exceptId ?? "", combo);
  return conflicts[0] ?? null;
}
