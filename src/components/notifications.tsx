import { useStore } from '@nanostores/react'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, AlertTriangle, CheckCircle2, Copy, Info, X } from 'lucide-react'

// mirach 适配：hermes 的 UI 套件（Alert/Button/Codicon/CopyButton）与 i18n
// 在 mirach 没有对应物——以下垫片按 hermes 同名组件的用法实现最小面，
// 组件主体逻辑保持 hermes 原样。
import { triggerHaptic } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import {
  $notifications,
  type AppNotification,
  clearNotifications,
  dismissNotification,
  type NotificationKind
} from '@/store/notifications'

type IconComponent = typeof AlertCircle

// -- i18n 垫片：hermes t.notifications 词条的 mirach 中文直配 ------------------
const copy = {
  region: '通知',
  hide: '收起',
  show: '展开',
  more: (n: number) => `等 ${n} 条`,
  clearAll: '全部清除',
  dismiss: '关闭',
  details: '详细信息',
  copyDetail: '复制详情',
  copyDetailFailed: '复制失败'
}

function CopyButton({ className, errorMessage, iconClassName, label, detail }: {
  className?: string
  errorMessage?: string
  iconClassName?: string
  label?: string
  detail: string
}) {
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground', className)}
      onClick={() => {
        void navigator.clipboard.writeText(detail).catch(() => {
          if (errorMessage) window.setTimeout(() => window.alert(errorMessage), 0)
        })
      }}
    >
      <Copy className={cn('size-3', iconClassName)} />
      {label}
    </button>
  )
}

const BUTTON_VARIANTS: Record<string, string> = {
  default: 'bg-[#303030] text-white hover:opacity-85',
  ghost: 'hover:bg-black/5',
  text: 'hover:bg-black/5'
}
const BUTTON_SIZES: Record<string, string> = {
  xs: 'h-6 px-2 text-xs',
  sm: 'h-7 px-3 text-xs',
  'icon-xs': 'h-5 w-5'
}

function Button({ className, onClick, size = 'sm', variant = 'default', ariaLabel, children }: {
  className?: string
  onClick?: () => void
  size?: string
  /** hermes Button 的 type prop（HTML 原生）；垫片恒为 button，仅收掉该 prop */
  type?: string
  variant?: string
  ariaLabel?: string
  children?: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors',
        BUTTON_VARIANTS[variant] ?? BUTTON_VARIANTS.default,
        BUTTON_SIZES[size] ?? BUTTON_SIZES.sm,
        className
      )}
    >
      {children}
    </button>
  )
}

const ALERT_VARIANTS: Record<string, string> = {
  default: 'bg-white text-[#303030]',
  destructive: 'bg-white text-[#EF4444]',
  warning: 'bg-white text-[#F59E0B]',
  success: 'bg-white text-[#10B981]'
}

function Alert({ className, role, variant = 'default', children }: {
  className?: string
  role?: string
  variant?: string
  children: ReactNode
}) {
  return (
    <div
      role={role}
      className={cn(
        'relative grid w-full grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-xl px-3.5 py-2.5 text-sm shadow-lg',
        ALERT_VARIANTS[variant] ?? ALERT_VARIANTS.default,
        className
      )}
    >
      {children}
    </div>
  )
}

function AlertTitle({ className, title, children }: { className?: string; title?: string; children: ReactNode }) {
  return (
    <p className={cn('m-0 font-semibold leading-snug', className)} title={title}>
      {children}
    </p>
  )
}

function AlertDescription({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('text-[13px] text-[#464646]', className)}>
      {children}
    </div>
  )
}

function Codicon({ className, name, size, style }: {
  className?: string
  name: string
  size: string
  style?: CSSProperties
}) {
  if (name === 'close') {
    return <X className={className} style={{ width: size, height: size, ...style }} />
  }
  return <Info className={className} style={{ width: size, height: size, ...style }} />
}

type ToneVariant = 'default' | 'destructive' | 'warning' | 'success'

const tone: Record<NotificationKind, { icon: IconComponent; iconClass: string; variant: ToneVariant }> = {
  error: { icon: AlertCircle, iconClass: 'text-destructive', variant: 'destructive' },
  warning: { icon: AlertTriangle, iconClass: 'text-primary', variant: 'warning' },
  info: { icon: Info, iconClass: 'text-muted-foreground', variant: 'default' },
  success: { icon: CheckCircle2, iconClass: 'text-primary', variant: 'success' }
}

const STACK_SURFACE = 'pointer-events-auto border border-(--stroke-nous) bg-popover/95 shadow-nous backdrop-blur-md'

function partitionNotifications(notifications: AppNotification[]) {
  const defaultStack: AppNotification[] = []
  const bottomRightStack: AppNotification[] = []

  for (const notification of notifications) {
    if (notification.placement === 'bottom-right') {
      bottomRightStack.push(notification)
    } else {
      defaultStack.push(notification)
    }
  }

  return { bottomRightStack, defaultStack }
}

export function NotificationStack() {
  const notifications = useStore($notifications)
  const { bottomRightStack, defaultStack } = partitionNotifications(notifications)
  const lastNotificationIdRef = useRef<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (defaultStack.length <= 1) {
      setExpanded(false)
    }
  }, [defaultStack.length])

  // eslint-disable-next-line no-restricted-syntax -- legitimate non-atom ref write (see eslint rule comment)
  useEffect(() => {
    const latest = notifications[0]

    if (!latest || latest.id === lastNotificationIdRef.current) {
      return
    }

    lastNotificationIdRef.current = latest.id

    if (latest.kind === 'success') {
      triggerHaptic('success')
    } else if (latest.kind === 'error') {
      triggerHaptic('error')
    } else if (latest.kind === 'warning') {
      triggerHaptic('warning')
    }
  }, [notifications])

  return (
    <>
      {defaultStack.length > 0 && (
        <TopCenterStack
          copy={copy}
          expanded={expanded}
          notifications={defaultStack}
          onToggleExpanded={() => setExpanded(v => !v)}
        />
      )}
      {bottomRightStack.length > 0 && <BottomRightStack copy={copy} notifications={bottomRightStack} />}
    </>
  )
}

// Portaled to <body> on the over-modal rung so a toast clears an open dialog —
// see the top-center variant below for why.
const REGION_BASE = 'pointer-events-none fixed z-(--z-over-modal) flex gap-2'

// Primary stack: top-center, collapsed to the latest toast with a "+N more"
// expander + clear-all — the noisy/important surface (errors, warnings,
// action toasts). Without the portal it lives inside the React root subtree,
// which any body-level dialog/overlay portal paints over — so a toast fired
// while a dialog is open was invisible.
function TopCenterStack({
  copy: copyText,
  expanded,
  notifications,
  onToggleExpanded
}: {
  copy: typeof copy
  expanded: boolean
  notifications: AppNotification[]
  onToggleExpanded: () => void
}) {
  const [latest, ...older] = notifications

  return createPortal(
    <div
      aria-label={copyText.region}
      className={cn(
        REGION_BASE,
        'left-1/2 top-[calc(var(--titlebar-height,34px)+0.75rem)] w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 flex-col'
      )}
      role="region"
    >
      <NotificationItem notification={latest} />
      {expanded && older.map(n => <NotificationItem key={n.id} notification={n} />)}
      {older.length > 0 && (
        <div className={cn(STACK_SURFACE, 'flex min-h-8 items-center justify-between rounded-lg px-3 text-xs')}>
          <Button className="-ml-2" onClick={onToggleExpanded} size="xs" type="button" variant="text">
            {expanded ? copyText.hide : copyText.show} {copyText.more(older.length)}
          </Button>
          <Button className="-mr-2" onClick={clearNotifications} size="xs" type="button" variant="text">
            {copyText.clearAll}
          </Button>
        </div>
      )}
    </div>,
    document.body
  )
}

// Ambient stack: bottom-right, every toast shown at once (routine confirmations
// rarely queue up), newest on top, no expand/clear-all chrome.
function BottomRightStack({
  copy: copyText,
  notifications
}: {
  copy: typeof copy
  notifications: AppNotification[]
}) {
  return createPortal(
    <div
      aria-label={copyText.region}
      className={cn(REGION_BASE, 'right-4 bottom-4 w-[min(24rem,calc(100%-2rem))] flex-col-reverse')}
      role="region"
    >
      {notifications.map(n => (
        <NotificationItem key={n.id} notification={n} />
      ))}
    </div>,
    document.body
  )
}

// Emphasize only the leading money figure ("$16.00" — the amount used) with the
// accent color (semibold), leaving the rest of the line in its default muted
// tone. No accent, or no figure in the message → render the text untouched.
function renderMessage(message: string, accent?: string): ReactNode {
  const match = accent ? /\$\d+(?:\.\d{2})?/.exec(message) : null

  if (!match) {
    return message
  }

  const start = match.index
  const end = start + match[0].length

  return (
    <>
      {message.slice(0, start)}
      <span className="font-semibold" style={{ color: accent }}>
        {match[0]}
      </span>
      {message.slice(end)}
    </>
  )
}

// AlertTitle defaults to a single-line clamp. Toast errors are often a full
// sentence, so the toast wraps — then caps height and scrolls instead of
// growing down the chat or clipping with an ellipsis.
export function toastTitleClassName() {
  return 'col-start-auto line-clamp-none max-h-[4.5em] overflow-y-auto overscroll-contain whitespace-normal wrap-break-word'
}

function NotificationItem({ notification }: { notification: AppNotification }) {
  const styles = tone[notification.kind]
  const Icon = styles.icon
  const hasDetail = Boolean(notification.detail && notification.detail !== notification.message)

  // Nudge the icon down to sit on the first text line, in `ch` so it tracks the
  // toast's font size instead of a fixed rem. `accentColor` (when set) tints the
  // icon + message as a severity ramp, overriding the kind's default color.
  const accent = notification.accentColor
  const iconStyle: CSSProperties = { marginTop: '0.42ch', ...(accent ? { color: accent } : {}) }

  return (
    <Alert
      aria-live={notification.kind === 'error' ? 'assertive' : 'polite'}
      className={cn(STACK_SURFACE, 'grid-cols-[auto_minmax(0,1fr)_auto] pr-2.5')}
      role={notification.kind === 'error' ? 'alert' : 'status'}
      variant={styles.variant}
    >
      {notification.icon ? (
        <Codicon className={styles.iconClass} name={notification.icon} size="1rem" style={iconStyle} />
      ) : (
        <Icon className={styles.iconClass} style={iconStyle} />
      )}
      <div className="col-start-2 min-w-0">
        {notification.title && (
          <AlertTitle className={toastTitleClassName()} title={notification.title}>
            {notification.title}
          </AlertTitle>
        )}
        <AlertDescription className="col-start-auto">
          <p className="m-0 wrap-break-word">{renderMessage(notification.message, accent)}</p>
          {notification.meta && <p className="m-0 text-xs text-muted-foreground tabular-nums">{notification.meta}</p>}
          {hasDetail && <NotificationDetail detail={notification.detail || ''} />}
          {notification.action && (
            <Button
              className="mt-1.5"
              onClick={() => {
                notification.action?.onClick()
                dismissNotification(notification.id)
              }}
              size="sm"
              type="button"
              variant="default"
            >
              {notification.action.label}
            </Button>
          )}
        </AlertDescription>
      </div>
      <Button
        aria-label={copy.dismiss}
        className="col-start-3 -mr-1 text-muted-foreground"
        onClick={() => dismissNotification(notification.id)}
        size="icon-xs"
        type="button"
        variant="ghost"
      >
        <Codicon name="close" size="0.875rem" />
      </Button>
    </Alert>
  )
}

function NotificationDetail({ detail }: { detail: string }) {

  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="select-none font-medium text-muted-foreground hover:text-foreground">{copy.details}</summary>
      <div className="mt-1 rounded-md bg-background/65 p-2">
        <pre
          className="max-h-32 whitespace-pre-wrap wrap-break-word font-mono text-[0.6875rem] leading-relaxed"
          data-selectable-text="true"
        >
          {detail}
        </pre>
        <CopyButton
          className="mt-1 rounded px-1.5 py-0.5 text-[0.6875rem]"
          errorMessage={copy.copyDetailFailed}
          iconClassName="size-3"
          label={copy.copyDetail}
          detail={detail}
        />
      </div>
    </details>
  )
}

export function InlineNotice({
  kind = 'info',
  title,
  children,
  className
}: {
  kind?: NotificationKind
  title?: string
  children: ReactNode
  className?: string
}) {
  const styles = tone[kind]
  const Icon = styles.icon

  return (
    <Alert className={cn('min-w-0', className)} role={kind === 'error' ? 'alert' : 'status'} variant={styles.variant}>
      <Icon />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className={cn(!title && 'row-start-1')}>{children}</AlertDescription>
    </Alert>
  )
}
