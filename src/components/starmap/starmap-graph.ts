// Starmap graph types — mirach 适配层：hermes 的 StarmapNode/Edge/Graph 描述
// 「学到的 skill + memory」图。mirach 把同一图结构喂给同款渲染引擎：
// 节点 = 环境成员/会话/产物（kind 仍用 'memory' | 'skill' 两个形状语义，
// memory=普通星、skill=多面体星），边 = 关联（同一环境的成员↔会话）。

export interface StarmapNode {
  id: string
  label: string
  kind: 'memory' | 'skill'
  memorySource?: 'memory' | 'profile'
  timestamp?: null | number
  category: string
  useCount: number
  state: string
  createdBy: null | string
  pinned: boolean
}

/** A declared link; both endpoints are guaranteed to be nodes. */
export interface StarmapEdge {
  source: string
  target: string
}

export interface StarmapCluster {
  category: string
  count: number
}

/** Freeform card rendered as a card — never a graph node. */
export interface StarmapMemoryCard {
  source: 'memory' | 'profile'
  timestamp?: null | number
  title: string
  body: string
}

export interface StarmapGraph {
  nodes: StarmapNode[]
  edges: StarmapEdge[]
  clusters: StarmapCluster[]
  memory: StarmapMemoryCard[]
  stats: Record<string, unknown>
}
