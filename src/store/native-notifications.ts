import { atom } from 'nanostores'

import { $activeSessionId } from './session'
import { notify as desktopNotify } from '@/lib/notify'

// mirach 适配：hermes 的 persistString/storedString 是 Electron 存储垫片；
// mirach 直接用 localStorage。基线抑制期（首启动静默窗）无对应物——恒放行。
function storedString(key: string): null | string {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function persistString(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}
function withinNativeNotifyBaseline(): boolean {
  return false
}

// Native OS notifications (Electron `Notification`), separate from the in-app
// toast feed in `notifications.ts`. Each kind toggles independently.
export type NativeNotificationKind =
  'approval' | 'backgroundDone' | 'credits' | 'input' | 'plugin' | 'turnDone' | 'turnError'

export const NATIVE_NOTIFICATION_KINDS: readonly NativeNotificationKind[] = [
  'approval',
  'input',
  'turnDone',
  'turnError',
  'backgroundDone',
  'credits',
  'plugin'
]

// Blocking prompts — surface even while focused if they're for another session.
const ATTENTION_KINDS = new Set<NativeNotificationKind>(['approval', 'input'])

export interface NativeNotificationPrefs {
  enabled: boolean
  kinds: Record<NativeNotificationKind, boolean>
}

const STORAGE_KEY = 'hermes:native-notifications'

const DEFAULT_PREFS: NativeNotificationPrefs = {
  enabled: true,
  kinds: {
    approval: true,
    backgroundDone: true,
    credits: true,
    input: true,
    plugin: true,
    turnDone: true,
    turnError: true
  }
}

function readPrefs(): NativeNotificationPrefs {
  const raw = storedString(STORAGE_KEY)

  if (!raw) {
    return DEFAULT_PREFS
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NativeNotificationPrefs>
    const kinds = { ...DEFAULT_PREFS.kinds }

    for (const kind of NATIVE_NOTIFICATION_KINDS) {
      const value = parsed.kinds?.[kind]

      if (typeof value === 'boolean') {
        kinds[kind] = value
      }
    }

    return {
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_PREFS.enabled,
      kinds
    }
  } catch {
    return DEFAULT_PREFS
  }
}

export const $nativeNotifyPrefs = atom<NativeNotificationPrefs>(readPrefs())

function writePrefs(next: NativeNotificationPrefs) {
  $nativeNotifyPrefs.set(next)
  persistString(STORAGE_KEY, JSON.stringify(next))
}

export function setNativeNotifyEnabled(enabled: boolean) {
  writePrefs({ ...$nativeNotifyPrefs.get(), enabled })
}

export function setNativeNotifyKind(kind: NativeNotificationKind, on: boolean) {
  const prev = $nativeNotifyPrefs.get()
  writePrefs({ ...prev, kinds: { ...prev.kinds, [kind]: on } })
}

// De-dupe replayed events for the same kind+session. Self-evicting: entries
// older than the window are pruned on every dispatch, so the map can't grow.
const THROTTLE_MS = 1000
const lastFiredAt = new Map<string, number>()

function throttled(key: string, now: number): boolean {
  for (const [k, at] of lastFiredAt) {
    if (now - at >= THROTTLE_MS) {
      lastFiredAt.delete(k)
    }
  }

  if (lastFiredAt.has(key)) {
    return true
  }

  lastFiredAt.set(key, now)

  return false
}

// "Backgrounded" = the user isn't on Hermes. `document.hidden` only flips when
// minimized/occluded; an alt-tabbed window is visible-but-unfocused, so we also
// check `document.hasFocus()`.
function isBackgrounded(): boolean {
  if (typeof document === 'undefined') {
    return false
  }

  if (document.hidden) {
    return true
  }

  return typeof document.hasFocus === 'function' && !document.hasFocus()
}

function shouldFire(kind: NativeNotificationKind, sessionId?: null | string, global = false): boolean {
  // Global notifications aren't tied to a chat session (e.g. pet generation,
  // which runs from the command center with no active conversation). They fire
  // whenever the user is away, with no session-match requirement — otherwise a
  // background run started without an open session would be silently dropped.
  if (global) {
    return isBackgrounded()
  }

  // Attention kinds break through for an off-screen session even while focused.
  if (ATTENTION_KINDS.has(kind)) {
    return isBackgrounded() || (Boolean(sessionId) && sessionId !== $activeSessionId.get())
  }

  // Completion kinds: only the active session, only while away — so a busy
  // gateway (messaging, kanban, cron) can't spam a toast per background session.
  return isBackgrounded() && Boolean(sessionId) && sessionId === $activeSessionId.get()
}

export interface NativeNotificationAction {
  id: string
  text: string
  /** Serializable activate target echoed back on button press (plugin path). */
  activate?: string
}

export interface NativeNotificationInput {
  kind: NativeNotificationKind
  title: string
  body?: string
  sessionId?: null | string
  /**
   * Not tied to a chat session (e.g. pet generation). Fires whenever the user
   * is away, bypassing the session-match gate that completion kinds normally
   * require.
   */
  global?: boolean
  silent?: boolean
  actions?: NativeNotificationAction[]
  /**
   * Extra throttle/dedupe discriminator for session-less notifications (e.g.
   * the plugin id), so unrelated emitters of the same kind don't collapse
   * into one another. Never drives click-to-focus like `sessionId` does.
   */
  tag?: string
  /** Absolute file path for the OS notification icon (Electron). */
  icon?: string
  /**
   * Resolved hash-router path to open on body click when there is no
   * `sessionId` (plugins). Same vocabulary as `hermes://index-network/intent/1`.
   */
  activate?: string
  /** Renderer-side handle so click/action can invoke registered callbacks. */
  notifyId?: string
}

/** Returns true when the notification passed every guard and was handed to the
 *  OS bridge — callers registering per-notification state (plugin handlers)
 *  must only do so on true, or suppressed/throttled notifications leak it. */
export function dispatchNativeNotification(input: NativeNotificationInput): boolean {
  const prefs = $nativeNotifyPrefs.get()

  if (!prefs.enabled || !prefs.kinds[input.kind]) {
    return false
  }

  if (withinNativeNotifyBaseline()) {
    return false
  }

  if (!shouldFire(input.kind, input.sessionId, input.global)) {
    return false
  }

  if (throttled(`${input.kind}:${input.sessionId ?? input.tag ?? (input.global ? 'global' : '')}`, Date.now())) {
    return false
  }

  // mirach 适配：Electron 桥 → Tauri Web Notification（标题+正文；OS 级
  // 按钮动作在 Web Notification 上不可用，忽略）
  desktopNotify(input.title, input.body)

  return true
}

// -- the plugin door (`ctx.os.notify`) ----------------------------------------

export interface PluginNotificationAction {
  id: string
  label: string
  /** Navigate here on button press.（hermes 深链目标；mirach 暂不支持） */
  activate?: unknown
  /** Renderer callback — only `id` crosses IPC; this stays in-process. */
  onAction?: () => void
}

export interface PluginNativeNotificationInput {
  title: string
  body?: string
  silent?: boolean
  /** Absolute filesystem path for the notification icon. */
  icon?: string
  /**
   * Where body-click should land.（hermes 的深链目标类型；mirach 无对应
   * 路由器，暂不支持 body-click 导航，仅保留 onActivate 回调）
   */
  activate?: unknown
  /** Extra work on body click (runs in addition to `activate` navigation). */
  onActivate?: () => void
  actions?: PluginNotificationAction[]
}

interface PendingPluginNotify {
  onActivate?: () => void
  actions: Map<string, () => void>
}

const pendingPluginNotify = new Map<string, PendingPluginNotify>()

function mintNotifyId(pluginId: string): string {
  return `${pluginId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`
}

/** Invoke body-click callback if one was registered for this notify id. */
export function invokePluginNotifyActivate(notifyId: string | undefined): void {
  if (!notifyId) {
    return
  }

  const pending = pendingPluginNotify.get(notifyId)
  pending?.onActivate?.()
}

/** Invoke an action-button callback. Returns true when a handler ran. */
export function invokePluginNotifyAction(notifyId: string | undefined, actionId: string | undefined): boolean {
  if (!notifyId || !actionId) {
    return false
  }

  const handler = pendingPluginNotify.get(notifyId)?.actions.get(actionId)

  if (!handler) {
    return false
  }

  handler()

  return true
}

/** Drop pending handlers (tests / after a click consumed the toast). */
export function clearPluginNotifyHandlers(notifyId?: string): void {
  if (notifyId) {
    pendingPluginNotify.delete(notifyId)

    return
  }

  pendingPluginNotify.clear()
}

/** Native OS notification on behalf of a plugin. One "Plugin notifications"
 *  preference gates all plugins; the plugin id keys throttling/dedupe so two
 *  plugins can't collapse each other's notifications. Fires only while the
 *  user is away from Hermes — the in-app toast (`host.notify`) covers the
 *  foreground case. */
export function dispatchPluginNativeNotification(pluginId: string, input: PluginNativeNotificationInput): void {
  // mirach 适配：无 hermes 深链路由器，activate 不解析（仅保留回调）
  const notifyId = input.onActivate || input.actions?.some(a => a.onAction) ? mintNotifyId(pluginId) : undefined

  const actions: NativeNotificationAction[] | undefined = input.actions?.map(action => ({
    id: action.id,
    text: action.label
  }))

  const fired = dispatchNativeNotification({
    actions,
    body: input.body,
    global: true,
    icon: input.icon,
    kind: 'plugin',
    notifyId,
    silent: input.silent,
    tag: pluginId,
    title: input.title
  })

  // Register renderer callbacks only for notifications that actually reached
  // the OS — a throttled/suppressed one can never be clicked, so registering
  // first would leak the closures for the window's lifetime.
  if (fired && notifyId) {
    const handlers = new Map<string, () => void>()

    for (const action of input.actions ?? []) {
      if (action.onAction) {
        handlers.set(action.id, action.onAction)
      }
    }

    pendingPluginNotify.set(notifyId, { actions: handlers, onActivate: input.onActivate })
  }
}

// mirach 适配：hermes 的审批通知按钮走 gateway 'approval.respond'——mirach
// 的审批经官方 ui-approval 包处理，OS 通知上无按钮，此函数无对应物，移除。

// Settings "send test" — bypasses gating. Returns whether the OS accepted it so
// the panel can flag a silent permission failure instead of looking dead.
export async function sendTestNativeNotification(title: string, body: string): Promise<boolean> {
  // mirach 适配：Web Notification 无"是否被 OS 接受"回执——权限已授予即成功
  desktopNotify(title, body)
  return typeof Notification !== 'undefined' && Notification.permission === 'granted'
}
