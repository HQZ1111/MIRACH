// 整库移植自 hermes 桌面端 app/starmap/share-controls.tsx。
// mirach 适配：Dialog/CopyButton/Tip/i18n/Upload 换 mirach 等价物
// （dialog 面用 mirach ui/dialog；Tip→title 属性；文案内联中文）。
import { useState } from 'react'
import { Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'

interface ShareControlsProps {
  // True when the shown map was loaded from a pasted code (not the live scan).
  imported?: boolean
  // Decode + apply a pasted code. Returns an error string to show inline, or null.
  onImport?: (code: string) => null | string
  onResetMap?: () => void
  // The current map serialized as a WoW-style share code (the copy target).
  shareCode?: string
}

// Share / import a map as a single code. The textarea shows the current map's
// code (copy it to share); edit/replace it and hit Load to view someone else's.
// One field, one button — a standard Dialog matching rename/create.
export function ShareControls({ imported = false, onImport, onResetMap, shareCode }: ShareControlsProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [copied, setCopied] = useState(false)

  const own = (shareCode ?? '').trim()
  const code = value.trim()
  const canLoad = code !== '' && code !== own

  const load = () => {
    if (!code) {
      setError('请粘贴分享码')

      return
    }

    const err = onImport?.(code) ?? null
    setError(err)

    if (err === null) {
      setOpen(false)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {imported && (
        <Button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => onResetMap?.()}
          size="sm"
          variant="ghost"
        >
          回到我的星图
        </Button>
      )}

      <Dialog
        onOpenChange={next => {
          setOpen(next)
          setError(null)

          if (next) {
            setValue(shareCode ?? '')
          }
        }}
        open={open}
      >
        <DialogTrigger
          aria-label="分享 / 导入星图"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
          title="分享 / 导入星图"
        >
          <Upload className="size-3.5" />
        </DialogTrigger>

        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>分享 / 导入星图</DialogTitle>
            <DialogDescription>
              当前星图编码为一段分享码；粘贴他人的分享码可导入查看。
            </DialogDescription>
          </DialogHeader>

          {/* One code field: pre-filled with this map's code (copy to share); edit
            or paste another and Load. Copy button floats in on hover, like a
            thread code block. */}
          <div className="group/code relative">
            <textarea
              aria-label="分享 / 导入星图"
              className="h-24 w-full resize-none rounded-md bg-foreground/5 p-2.5 pr-9 font-mono text-xs leading-relaxed break-all text-muted-foreground/90 outline-none transition placeholder:text-muted-foreground/50 focus-visible:text-foreground focus-visible:ring-1 focus-visible:ring-ring/40"
              onChange={e => {
                setValue(e.target.value)
                setError(null)
              }}
              placeholder="粘贴分享码…"
              spellCheck={false}
              value={value}
            />
            {code !== '' && (
              <button
                type="button"
                className="absolute right-1.5 top-1.5 flex h-5 items-center gap-1 rounded-md px-1 text-[0.6875rem] text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover/code:opacity-100 hover:opacity-100"
                onClick={() => {
                  void navigator.clipboard
                    .writeText(value)
                    .then(() => setCopied(true))
                    .catch(() => undefined)
                }}
              >
                <Upload className="hidden size-3" />
                {copied ? '已复制' : '复制'}
              </button>
            )}
          </div>

          {error && <p className="text-[0.7rem] text-destructive">{error}</p>}

          <Button className="w-full" disabled={!canLoad} onClick={load} type="button">
            导入
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
