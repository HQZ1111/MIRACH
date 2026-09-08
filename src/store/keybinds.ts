// 整库移植自 hermes 桌面端 store/keybinds.ts：绑定存储/冲突/捕获机制原样。
// 适配点：persistString/storedString/arraysEqual 内联（hermes 的 lib/storage
// 垫片）；$registryVersion 依赖去掉（mirach 贡献动作为导入期注册，$comboIndex
// 只依赖 $bindings；贡献动作注册后 bump $bindings 即可生效）。
import { atom, computed } from 'nanostores'

import {
  allKeybindActions,
  defaultBindings,
  keybindAction,
  type KeybindBindings,
} from '@/lib/keybinds/actions'
import { canonicalizeCombo } from '@/lib/keybinds/combo'

const STORAGE_KEY = 'mirach.desktop.keybinds'

function storedString(key: string): null | string {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function persistString(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}
function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

// The user's raw stored overrides. Kept verbatim so an action CONTRIBUTED
// after module init (plugins register late) still resolves its saved rebind —
// `bindingsFor` consults this before falling back to shipped defaults.
function readStoredOverrides(): Record<string, string[]> {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string[]> = {}

    for (const [id, value] of Object.entries(parsed)) {
      if (Array.isArray(value)) {
        out[id] = value.filter((combo): combo is string => typeof combo === 'string')
      }
    }

    return out
  } catch {
    // Corrupt storage falls back to defaults.
    return {}
  }
}

const storedOverrides = readStoredOverrides()

// Defaults overlaid with the user's stored overrides. Unknown / stale action
// ids are dropped; actions added in a later release pick up their shipped
// default; late-registered contributed actions resolve via `bindingsFor`.
function loadBindings(): KeybindBindings {
  const base = defaultBindings()

  for (const id of Object.keys(base)) {
    if (storedOverrides[id]) {
      base[id] = storedOverrides[id]
    }
  }

  return base
}

// Persist only the actions whose combos differ from their shipped default, so
// changing a default never gets shadowed by a stored snapshot.
function persistBindings(bindings: KeybindBindings): void {
  const defaults = defaultBindings()
  const diff: KeybindBindings = {}

  for (const action of allKeybindActions()) {
    const current = bindings[action.id] ?? []

    if (!arraysEqual(current, defaults[action.id] ?? [])) {
      diff[action.id] = current
    }
  }

  persistString(STORAGE_KEY, JSON.stringify(diff))
}

export const $bindings = atom<KeybindBindings>(loadBindings())

$bindings.subscribe(persistBindings)

/** Live combos for an action: explicit binding → stored override → default. */
export function bindingsFor(id: string, bindings: KeybindBindings = $bindings.get()): string[] {
  return bindings[id] ?? storedOverrides[id] ?? [...(keybindAction(id)?.defaults ?? [])]
}

// Reverse lookup combo → actionId for dispatch. First action wins on conflict;
// the panel/edit overlay surface conflicts so users can resolve them. Keys go
// through `canonicalizeCombo` so a `ctrl+…` binding resolves everywhere.
export const $comboIndex = computed($bindings, bindings => {
  const index = new Map<string, string>()

  for (const action of allKeybindActions()) {
    for (const combo of bindingsFor(action.id, bindings)) {
      const key = canonicalizeCombo(combo)

      if (!index.has(key)) {
        index.set(key, action.id)
      }
    }
  }

  return index
})

export function setBinding(actionId: string, combos: string[]): void {
  if (!keybindAction(actionId)) {
    return
  }

  $bindings.set({ ...$bindings.get(), [actionId]: [...combos] })
}

export function resetBinding(actionId: string): void {
  const action = keybindAction(actionId)

  if (!action) {
    return
  }

  $bindings.set({ ...$bindings.get(), [actionId]: [...action.defaults] })
}

export function resetAllBindings(): void {
  $bindings.set(defaultBindings())
}

// Other actions that already use `combo` (excluding `actionId` itself).
export function conflictsFor(actionId: string, combo: string): string[] {
  const bindings = $bindings.get()

  return allKeybindActions()
    .map(action => action.id)
    .filter(id => id !== actionId && bindingsFor(id, bindings).includes(combo))
}

// ── Capture ─────────────────────────────────────────────────────────────────
// `$capture` is the action currently listening for its next keypress (a panel
// row armed for rebinding). Session-only — never persisted.

export const $capture = atom<string | null>(null)

export function beginCapture(actionId: string): void {
  $capture.set(actionId)
}

export function endCapture(): void {
  $capture.set(null)
}
