// mirach 适配层：hermes 的 StarmapView（app/starmap/index.tsx）结构原样，
// 外壳换 OverlayShell，i18n 词条内联，PageLoader 换轻量实现。
// 数据经 store/starmap.ts（mirach 版 loadStarmapGraph，由 $sessions 适配生成）。
import { useStore } from '@nanostores/react'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

import { $starmapError, $starmapGraph, $starmapLoading, loadStarmapGraph } from '@/store/starmap'
import type { StarmapGraph } from './starmap-graph'

import { OverlayShell } from '../overlays/OverlayShell'

import { StarMap } from './star-map'

// Star map overlay: a top-down map of what the current environments hold,
// over a radial time axis. Data is fetched on demand into the $starmap* atoms;
// the map itself lives in ./star-map. The chrome is owned by the map itself
// (timeline scrubber + legend float over the canvas), so there's no panel
// header here.
export function StarmapView({ onClose }: { onClose: () => void }) {
  const graph = useStore($starmapGraph)
  const loading = useStore($starmapLoading)
  const error = useStore($starmapError)

  // A pasted share code populates the map with someone else's (or an exported)
  // graph, overriding the live scan. Cleared by "back to my map" and whenever a
  // fresh graph loads in.
  const [imported, setImported] = useState<StarmapGraph | null>(null)

  useEffect(() => {
    void loadStarmapGraph()
  }, [])

  // Drop a stale import when the underlying graph changes out from under it.
  useEffect(() => {
    setImported(null)
  }, [graph])

  const shown = imported ?? graph

  return (
    <OverlayShell title="会话星图" onClose={onClose} width={1040} height={720}>
      {error ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <p className="font-medium text-[#303030]">星图加载失败</p>
          <p>{error}</p>
        </div>
      ) : !shown && loading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : shown && shown.nodes.length === 0 && !imported ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-1 text-sm">
          <p className="font-medium text-[#303030]">星图还是空的</p>
          <p className="text-muted-foreground">开始会话与任务后，星图会随记录自动点亮</p>
        </div>
      ) : shown ? (
        <StarMap
          graph={shown}
          imported={imported !== null}
          onImport={setImported}
          onResetMap={() => setImported(null)}
        />
      ) : null}
    </OverlayShell>
  )
}
