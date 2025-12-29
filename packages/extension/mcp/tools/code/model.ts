export type DataHint = Record<string, string>

export type AutoLayoutHint = 'none' | 'inferred'

export type NodeSnapshot = {
  id: string
  type: SceneNode['type']
  tag: string
  name: string
  visible: boolean
  parentId?: string
  children: string[]
  bounds: { x: number; y: number; width: number; height: number }
  renderBounds?: { x: number; y: number; width: number; height: number } | null
  assetKind?: 'vector' | 'image'
  dataHint?: DataHint
  autoLayoutHint?: AutoLayoutHint
  node: SceneNode
}

export type TreeStats = {
  totalNodes: number
  maxDepth: number
  depthLimit?: number
  capped: boolean
  cappedNodeIds: string[]
}

export type VisibleTree = {
  rootIds: string[]
  nodes: Map<string, NodeSnapshot>
  order: string[]
  stats: TreeStats
}

export type CollectedData = {
  nodes: Map<string, NodeSnapshot>
  styles: Map<string, Record<string, string>>
  textSegments: Map<string, StyledTextSegment[] | null>
}
