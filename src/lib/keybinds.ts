/**
 * keybinds — 可重绑定快捷键（参考原型 lib/keybinds + store/keybinds）
 *
 * 动作注册表 + localStorage 覆盖持久化 + 事件匹配。默认值与
 * 设置页 Keybinds 表一致；用户重绑后仅持久化与默认不同的动作。
 *
 * 设计：
 * - combo 统一为 "mods+key" 小写形式，mods 按 ctrl/alt/shift/meta 排序
 * - "mod" 代表平台主修饰键（macOS=meta，其余=ctrl）
 * - fixed 动作（composer.send/newLine）仅展示，不参与全局分发
 */

export interface KeybindAction {
  id: string;
  label: string;
  group: string;
  defaultCombo: string;
  /** 固定动作（Enter/Shift+Enter 等文本区原生行为），仅展示不可重绑 */
  fixed?: boolean;
}

export const KEYBIND_ACTIONS: KeybindAction[] = [
  { id: "composer.send", label: "Send message", group: "Composer", defaultCombo: "Enter", fixed: true },
  { id: "composer.newLine", label: "New line", group: "Composer", defaultCombo: "Shift+Enter", fixed: true },
  { id: "commandPalette", label: "Open command palette", group: "Composer", defaultCombo: "Ctrl+K" },
  { id: "newSession", label: "New session", group: "Session", defaultCombo: "Ctrl+N" },
  { id: "switchSession", label: "Switch session", group: "Session", defaultCombo: "Ctrl+]" },
  { id: "jumpSession", label: "Jump to session", group: "Session", defaultCombo: "Ctrl+J" },
  { id: "toggleSidebar", label: "Toggle sidebar", group: "Navigation", defaultCombo: "Ctrl+B" },
  { id: "toggleRightSidebar", label: "Toggle right sidebar", group: "Navigation", defaultCombo: "Ctrl+Shift+B" },
  { id: "toggleTheme", label: "Toggle dark / light theme", group: "View", defaultCombo: "Shift+X" },
];

const STORAGE_KEY = "mirach.keybinds.v1";
const MOD_KEYS = ["ctrl", "alt", "shift", "meta", "mod"] as const;

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform);

export function canonicalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().trim().split(/\s*\+\s*/).filter(Boolean);
  const key = parts.find((p) => !(MOD_KEYS as readonly string[]).includes(p));
  const mods = parts
    .filter((p) => (MOD_KEYS as readonly string[]).includes(p))
    .sort((a, b) => MOD_KEYS.indexOf(a as (typeof MOD_KEYS)[number]) - MOD_KEYS.indexOf(b as (typeof MOD_KEYS)[number]));
  return [...mods, key ?? ""].join("+");
}

function normalizeKey(key: string): string {
  if (key === " ") return "space";
  if (key.length === 1) return key.toLowerCase();
  return key.toLowerCase();
}

export function comboFromEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("ctrl");
  if (e.altKey) mods.push("alt");
  if (e.shiftKey) mods.push("shift");
  if (e.metaKey) mods.push("meta");
  const key = e.key ? normalizeKey(e.key) : "";
  // 裸修饰键不构成组合
  if (MOD_KEYS.includes(key as (typeof MOD_KEYS)[number])) return "";
  return canonicalizeCombo([...mods, key].join("+"));
}

/** 事件是否命中某组合（"mod" 解析为平台主修饰键） */
export function matchCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = canonicalizeCombo(combo).split("+");
  const key = parts[parts.length - 1];
  if (!key || key === "mod") return false;
  const want = new Set(parts.slice(0, -1).map((p) => (p === "mod" ? (isMac ? "meta" : "ctrl") : p)));
  const gotMods = new Set<string>();
  if (e.ctrlKey) gotMods.add("ctrl");
  if (e.altKey) gotMods.add("alt");
  if (e.shiftKey) gotMods.add("shift");
  if (e.metaKey) gotMods.add("meta");
  if (normalizeKey(e.key) !== key) return false;
  if (want.size !== gotMods.size) return false;
  for (const m of want) if (!gotMods.has(m)) return false;
  return true;
}

function readOverrides(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(parsed)) {
      if (typeof v === "string" && KEYBIND_ACTIONS.some((a) => a.id === id)) out[id] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function defaultBindings(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of KEYBIND_ACTIONS) out[a.id] = a.defaultCombo;
  return out;
}

/** 当前生效绑定（默认 ⊙ 用户覆盖） */
export function bindings(): Record<string, string> {
  return { ...defaultBindings(), ...readOverrides() };
}

/** 重绑一个动作；重复组合自动交给第一个动作（设置页提示冲突） */
export function setBinding(actionId: string, combo: string): string {
  const c = canonicalizeCombo(combo);
  const overrides = readOverrides();
  overrides[actionId] = c;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* ignore */
  }
  return c;
}

export function resetAllBindings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** 查询某 combo 已被哪个动作占用（用于冲突提示；返回动作 id 或 null） */
export function ownerOf(combo: string, exceptId?: string): string | null {
  const c = canonicalizeCombo(combo);
  if (!c) return null;
  const map = bindings();
  for (const [id, comboStr] of Object.entries(map)) {
    if (id !== exceptId && canonicalizeCombo(comboStr) === c) return id;
  }
  return null;
}
