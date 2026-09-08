// 整库移植自 hermes 桌面端 app/starmap/node-context-menu.tsx。
// mirach 适配：节点 = 会话/成员快照（见 store/starmap.ts 适配层），无
// hermes 的 learning 后端——编辑改为本地星图快照改名（evict+重载语义与
// hermes 一致：乐观摘除 + 失败回滚），删除映射为 mirach 会话删除/归档确认。
import { useState } from 'react'
import { Archive, Trash2 } from 'lucide-react'

import { notifyError } from '@/store/notifications'
import { evictStarmapNode, loadStarmapGraph, renameStarmapNode } from '@/store/starmap'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export interface NodeMenuTarget {
  id: string
  kind: 'memory' | 'skill'
  label: string
  x: number
  y: number
}

interface NodeContextMenuProps {
  onClose: () => void
  onNodeRemoved: () => void
  target: NodeMenuTarget | null
}

interface EditState {
  content: string
  id: string
  label: string
}

/** Right-click actions for a star-map node: rename (modal) or delete (confirm). */
export function NodeContextMenu({ onClose, onNodeRemoved, target }: NodeContextMenuProps) {
  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<Omit<NodeMenuTarget, 'x' | 'y'> | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<null | string>(null)

  const noun = target?.kind === 'memory' ? '会话' : '记录'

  const openEdit = () => {
    if (!target) {
      return
    }

    setEditing({ content: target.label, id: target.id, label: target.label })
    onClose()
  }

  const save = async () => {
    if (!editing) {
      return
    }

    setSaving(true)
    setError(null)

    try {
      const rollback = renameStarmapNode(editing.id, editing.content)
      setEditing(null)
      void rollback.then(ok => {
        if (!ok) {
          void loadStarmapGraph(true)
        }
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const menuOpen = target && !editing && !deleting
  void noun

  return (
    <>
      {menuOpen ? (
        <>
          <div className="fixed inset-0 z-50" onClick={onClose} onContextMenu={e => e.preventDefault()} />
          {/* Styled to DropdownMenuContent/Item scale (rounded-lg card, p-1,
              text-xs rows) — the hand-rolled fixed positioning stays because
              the target is a canvas point, not a DOM anchor. */}
          <div
            className="fixed z-50 min-w-36 rounded-lg border border-border bg-white/95 p-1 shadow-md backdrop-blur-md"
            style={{ left: target.x, top: target.y }}
          >
            <div className="truncate px-2 py-1 text-[0.68rem] text-muted-foreground">{target.label}</div>
            <button
              className="block w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs hover:bg-muted disabled:opacity-50"
              onClick={openEdit}
              type="button"
            >
              重命名…
            </button>
            <button
              className="block w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
              onClick={() => {
                setDeleting({ id: target.id, kind: target.kind, label: target.label })
                onClose()
              }}
              type="button"
            >
              {target.kind === 'skill' ? (
                <>
                  <Archive className="mr-1 inline size-3" /> 归档会话
                </>
              ) : (
                <>
                  <Trash2 className="mr-1 inline size-3" /> 删除记录
                </>
              )}
            </button>
          </div>
        </>
      ) : null}

      <Dialog onOpenChange={value => !value && !saving && setEditing(null)} open={Boolean(editing)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>重命名 {editing?.label}</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            {editing && (
              <input
                autoFocus
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                key={editing.id}
                onChange={e => setEditing(prev => (prev ? { ...prev, content: e.target.value } : prev))}
                value={editing.content}
              />
            )}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button disabled={saving} onClick={() => setEditing(null)} type="button" variant="ghost">
              取消
            </Button>
            <Button disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        confirmLabel="删除"
        description="该记录会从星图中移除（会话走归档，可恢复）。"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) {
            return
          }

          const { id, label } = deleting
          const rollback = evictStarmapNode(id)
          onNodeRemoved()
          try {
            rollback()
          } catch (err) {
            notifyError(err, label)
          }
        }}
        open={Boolean(deleting)}
        title={`删除 ${deleting?.label ?? ''}？`}
      />
    </>
  )
}
