/**
 * starmap — 星图数据适配层
 *
 * 结构整库移植自 hermes 桌面端 store/starmap.ts：按需加载 + 缓存 + 节点
 * 摘除（乐观更新 + 回滚）+ 重置，逐行同源。数据源适配：hermes 的
 * getStarmapGraph 扫描后端（skills catalog/usage ledger/memory），mirach
 * 的星图数据完全在客户端——由 $sessions（含 createdAt/时间戳）与
 * $agents（成员/主人格）派生成同款 StarmapGraph：
 *   - skill 节点 = 会话（timestamp = createdAt，category = 所属环境）；
 *   - memory 节点 = 环境成员（timestamp 缺省，category = 环境）；
 *   - 边 = 成员 ↔ 其所在环境的最近会话（星图的连线语义）。
 */
import { atom } from 'nanostores'

import { $activeSessionId } from '@/store/session'
import { agentsEnv, $agents, loadAgentsOf } from '@/store/agents'
import { $environments } from '@/store/environments'
import { $sessions, hasSessionContent } from '@/store/sessions'
import { envOfSession } from '@/lib/session-env'
import type { StarmapEdge, StarmapGraph, StarmapNode } from '@/components/starmap/starmap-graph'

// On-demand cache for the star map. The graph derives from the session/agent
// stores, so we build it only when the panel opens (and on an explicit
// refresh), never on a turn boundary.
export const $starmapGraph = atom<StarmapGraph | null>(null)
export const $starmapLoading = atom(false)
export const $starmapError = atom<null | string>(null)

let inflight: Promise<void> | null = null

/** 从 $sessions/$agents 派生星图（mirach 数据面；形状 = hermes StarmapGraph） */
function buildGraphFromStores(): StarmapGraph {
  const nodes: StarmapNode[] = []
  const edges: StarmapEdge[] = []
  const clusterCount = new Map<string, number>()

  const envs = $environments.get()
  const envName = (id: string) => envs.find(e => e.id === id)?.name ?? id
  const activeId = $activeSessionId.get()

  // skill 节点 = 有内容的会话（category = 环境；active = 当前会话）
  const sessions = $sessions
    .get()
    .filter(s => !s.archived && hasSessionContent(s.id))

  for (const s of sessions) {
    // 归属环境：session-env 索引为准（会话隔离的同一份归属），无归属回 main
    const category = envName(sessionEnvOf(s.id))
    nodes.push({
      id: `session:${s.id}`,
      label: s.title || '新会话',
      kind: 'skill',
      timestamp: Math.floor(s.createdAt / 1000), // hermes 用秒级时间戳
      category,
      useCount: 0,
      state: s.id === activeId ? 'active' : 'draft',
      createdBy: null,
      pinned: s.pinned,
    })
    clusterCount.set(category, (clusterCount.get(category) ?? 0) + 1)
  }

  // memory 节点 = 各环境成员（当前环境全量 + 其他环境主人格聚合）
  const seenAgentIds = new Set<string>()
  for (const a of $agents.get()) {
    seenAgentIds.add(a.id)
    nodes.push({
      id: `agent:${a.id}`,
      label: a.name,
      kind: 'memory',
      memorySource: a.primary ? 'profile' : 'memory',
      timestamp: null,
      category: a.primary ? '主人格' : '成员',
      useCount: 0,
      state: a.status === 'pending' ? 'draft' : 'active',
      createdBy: null,
      pinned: false,
    })
    clusterCount.set(a.primary ? '主人格' : '成员', (clusterCount.get(a.primary ? '主人格' : '成员') ?? 0) + 1)
  }
  for (const env of envs) {
    if (env.id === agentsEnv()) continue // 当前环境成员已在上面
    for (const a of agentsOfEnv(env.id)) {
      if (seenAgentIds.has(a.id)) continue
      seenAgentIds.add(a.id)
      nodes.push({
        id: `agent:${env.id}:${a.id}`,
        label: a.name,
        kind: 'memory',
        memorySource: a.primary ? 'profile' : 'memory',
        timestamp: null,
        category: a.primary ? '主人格' : '成员',
        useCount: 0,
        state: a.status === 'pending' ? 'draft' : 'active',
        createdBy: null,
        pinned: false,
      })
      clusterCount.set(a.primary ? '主人格' : '成员', (clusterCount.get(a.primary ? '主人格' : '成员') ?? 0) + 1)
    }
  }

  // 边：每个会话连到其环境的第一个成员节点（星图连线语义；无成员则悬空）
  const agentNodeIds = new Set(nodes.filter(n => n.kind === 'memory').map(n => n.id))
  for (const n of nodes) {
    if (n.kind !== 'skill') continue
    const target = agentNodeIds.values().next()
    if (!target.done) {
      edges.push({ source: n.id, target: target.value })
    }
  }

  return {
    nodes,
    edges,
    clusters: [...clusterCount.entries()].map(([category, count]) => ({ category, count })),
    memory: [],
    stats: { sessions: sessions.length },
  }
}

// ---- 归属与环境查询（读自 session-env / agents 的公开面） ----

function sessionEnvOf(sessionId: string): string {
  return envOfSession(sessionId) ?? 'main'
}

function agentsOfEnv(envId: string) {
  // loadAgentsOf 纯读（localStorage → 种子），无初始化环
  return loadAgentsOf(envId)
}

export async function loadStarmapGraph(force = false): Promise<void> {
  if (inflight) {
    return inflight
  }

  if ($starmapGraph.get() && !force) {
    return
  }

  $starmapLoading.set(true)
  $starmapError.set(null)

  inflight = (async () => {
    try {
      // 构建是纯同步派生，rAF 一帧让 loading 态可见（hermes 是真网络扫描）
      await new Promise(resolve => requestAnimationFrame(resolve))
      $starmapGraph.set(buildGraphFromStores())
    } catch (err) {
      $starmapError.set(err instanceof Error ? err.message : String(err))
    } finally {
      $starmapLoading.set(false)
      inflight = null
    }
  })()

  return inflight
}

/** Drop one node from the cached graph immediately; return rollback. */
export function evictStarmapNode(id: string): () => void {
  const prev = $starmapGraph.get()

  if (!prev) {
    return () => {}
  }

  const next: StarmapGraph = {
    ...prev,
    nodes: prev.nodes.filter(node => node.id !== id),
    edges: prev.edges.filter(edge => edge.source !== id && edge.target !== id),
  }

  $starmapGraph.set(next)

  return () => $starmapGraph.set(prev)
}

/** 本地改名：直接改缓存快照；resolve false = 节点不在缓存（调用方重载）。 */
export async function renameStarmapNode(id: string, label: string): Promise<boolean> {
  const prev = $starmapGraph.get()

  if (!prev) {
    return false
  }

  const hit = prev.nodes.find(node => node.id === id)

  if (!hit) {
    return false
  }

  $starmapGraph.set({
    ...prev,
    nodes: prev.nodes.map(node => (node.id === id ? { ...node, label } : node)),
  })

  return true
}

/** Drop the cache so the next open refetches against the now-active state. */
export function resetStarmapGraph(): void {
  inflight = null
  $starmapGraph.set(null)
  $starmapError.set(null)
}
