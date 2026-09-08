// The single source of truth for rebindable desktop hotkeys.
// 整库移植自 hermes 桌面端 lib/keybinds/actions.ts：结构/机制原样
// （分类、槽位动作、贡献动作、只读展示行、defaultBindings），动作目录
// 换成 mirach 的对应面（hermes 的 profiles/终端/面板树在 mirach 无对应物）。
//
// Each entry is pure metadata: an id, a category, and the default combo(s).
// Handlers are wired separately in `hooks/useKeybinds.ts`. To add a hotkey,
// add a row here and a handler there — nothing else.

import { IS_MAC } from './combo'

export type KeybindCategory = 'composer' | 'session' | 'navigation' | 'view'

// The self-referential opener — bound + dispatched like any action, but shown in
// the panel subtitle (not as its own row).
export const KEYBIND_PANEL_ACTION = 'keybinds.openPanel'

// `composer` is read-only; the rest are rebindable. `view` is the catch-all for
// layout, appearance, and the panel-opener.
export const KEYBIND_CATEGORIES: readonly KeybindCategory[] = ['composer', 'session', 'navigation', 'view']

export interface KeybindActionMeta {
  id: string
  category: KeybindCategory
  /** Default combos. Empty = shipped unbound (user can assign one). */
  defaults: readonly string[]
  /** Display label（mirach：内置动作也带中文标签，hermes 走 i18n） */
  label?: string
}

// Positional jumps — ^1…^9（hermes session slot 同款：Ctrl+N 直达第 N 近会话）。
export const SESSION_SLOT_COUNT = 9

const SESSION_SLOT_ACTIONS: KeybindActionMeta[] = Array.from({ length: SESSION_SLOT_COUNT }, (_, i) => ({
  id: `session.slot.${i + 1}`,
  category: 'session' as const,
  defaults: [`ctrl+${i + 1}`],
}))

export const KEYBIND_ACTIONS: readonly KeybindActionMeta[] = [
  // ── Composer ─────────────────────────────────────────────────────────────
  { id: 'composer.focus', category: 'composer', defaults: ['mod+l'], label: '聚焦输入框' },
  // 语音听写/唤醒指令开关（hermes composer.voice 同位）
  { id: 'composer.voice', category: 'composer', defaults: [], label: '语音输入开关' },

  // ── Session ──────────────────────────────────────────────────────────────
  { id: 'session.new', category: 'session', defaults: ['mod+n'], label: '新建任务' },
  // ⌃Tab / ⌃⇧Tab — the universal tab-cycle chord. Literally Control, not Cmd
  // (macOS reserves Cmd+Tab for app switching); see `ctrl` in combo.ts.
  { id: 'session.next', category: 'session', defaults: ['ctrl+tab', 'ctrl+pagedown'], label: '下一个会话' },
  { id: 'session.prev', category: 'session', defaults: ['ctrl+shift+tab', 'ctrl+pageup'], label: '上一个会话' },
  ...SESSION_SLOT_ACTIONS,
  { id: 'session.focusSearch', category: 'session', defaults: ['mod+shift+f'], label: '聚焦会话搜索' },
  { id: 'session.jump', category: 'session', defaults: ['mod+j'], label: '会话切换器' },

  // ── Navigation ───────────────────────────────────────────────────────────
  { id: 'nav.commandPalette', category: 'navigation', defaults: ['mod+k', 'mod+p'], label: '命令面板' },
  { id: 'nav.settings', category: 'navigation', defaults: ['mod+,'], label: '打开设置' },
  { id: 'nav.artifacts', category: 'navigation', defaults: [], label: '产物' },
  { id: 'nav.kanban', category: 'navigation', defaults: [], label: '看板' },
  { id: 'nav.cron', category: 'navigation', defaults: [], label: '定时任务' },

  // ── View (layout + appearance + the shortcuts panel itself) ───────────────
  { id: 'view.toggleSidebar', category: 'view', defaults: ['mod+b'], label: '收起/展开侧栏' },
  { id: 'view.toggleRightSidebar', category: 'view', defaults: ['mod+j'.replace('mod+j', IS_MAC ? 'mod+i' : 'mod+shift+b')], label: '收起/展开右侧栏' },
  { id: 'appearance.toggleMode', category: 'view', defaults: ['shift+x'], label: '深色/浅色主题' },
  // 唤醒词开关（plugin-wake-word）与提示音静音（plugin-sound-cues）——
  // mirach 插件面接入快捷键体系的两个入口。
  { id: 'view.wakeToggle', category: 'view', defaults: [], label: '唤醒词开关' },
  { id: 'view.soundMute', category: 'view', defaults: [], label: '提示音静音' },
  // HUD 悬浮窗（hermes view.toggleHud 同位；⌘⇧H 与 hermes 默认一致）
  { id: 'view.toggleHud', category: 'view', defaults: ['mod+shift+h'], label: '悬浮窗 HUD' },
  { id: 'keybinds.openPanel', category: 'view', defaults: ['mod+/'], label: '快捷键面板' },
]

export const KEYBIND_ACTION_IDS: readonly string[] = KEYBIND_ACTIONS.map(action => action.id)

const ACTION_BY_ID = new Map(KEYBIND_ACTIONS.map(action => [action.id, action]))

// ── Contributed actions — 插件可注册的额外动作 ────────────────────────────────
// hermes 走 contrib/registry 的 `keybinds` area；mirach 用模块内注册表
// （registerKeybindContribution，导入即注册），机制与 hermes 同构：
// 贡献动作是一等公民——可分发、可重绑、覆盖持久化，内置 id 不可被遮蔽。

export const KEYBINDS_AREA = 'keybinds'

/** Payload of a `keybinds` data contribution. */
export interface KeybindContribution {
  id: string
  /** Panel section. Defaults to `view`. */
  category?: KeybindCategory
  /** Default combos (canonical form, e.g. `mod+shift+\\`). Empty = unbound. */
  defaults?: readonly string[]
  label: string
  run: () => void
}

const contributed: KeybindContribution[] = []

/** 注册一个插件快捷键动作（模块导入即注册，重复 id 忽略）。 */
export function registerKeybindContribution(contribution: KeybindContribution): void {
  if (contributed.some(c => c.id === contribution.id) || ACTION_BY_ID.has(contribution.id)) {
    return
  }
  contributed.push(contribution)
}

export function contributedKeybinds(): KeybindContribution[] {
  return contributed.filter(k => Boolean(k?.id && k.label) && typeof k?.run === 'function' && !ACTION_BY_ID.has(k.id))
}

/** Built-ins + contributed, one metadata list (panel, bindings, conflicts). */
export function allKeybindActions(): KeybindActionMeta[] {
  return [
    ...KEYBIND_ACTIONS,
    ...contributedKeybinds().map(k => ({
      id: k.id,
      category: k.category ?? ('view' as const),
      defaults: k.defaults ?? [],
      label: k.label
    }))
  ]
}

export function keybindAction(id: string): KeybindActionMeta | undefined {
  return ACTION_BY_ID.get(id) ?? allKeybindActions().find(action => action.id === id)
}

/** The contributed handler for an action id (built-ins wire theirs in useKeybinds). */
export function contributedKeybindHandler(id: string): (() => void) | undefined {
  return contributedKeybinds().find(k => k.id === id)?.run
}

export type KeybindBindings = Record<string, string[]>

export function defaultBindings(): KeybindBindings {
  return Object.fromEntries(allKeybindActions().map(action => [action.id, [...action.defaults]]))
}

// Fixed, non-rebindable shortcuts surfaced read-only in the panel so the map is
// complete.（hermes 的 composer 固定键行；mirach 同样存在，原样保留两行）
export interface KeybindReadonly {
  id: string
  category: KeybindCategory
  keys: readonly string[]
}

export const KEYBIND_READONLY: readonly KeybindReadonly[] = [
  { id: 'composer.send', category: 'composer', keys: ['enter'] },
  { id: 'composer.newline', category: 'composer', keys: ['shift+enter'] },
  { id: 'composer.cancel', category: 'composer', keys: ['escape'] },
]
