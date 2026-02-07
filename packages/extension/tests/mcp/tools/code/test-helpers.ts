import type { NodeSnapshot, VisibleTree } from '@/mcp/tools/code/model'

type SnapshotInput = {
  id: string
  type?: SceneNode['type']
  parentId?: string
  children?: string[]
}

export function createSnapshot({
  id,
  type = 'FRAME',
  parentId,
  children = []
}: SnapshotInput): NodeSnapshot {
  return {
    id,
    type,
    tag: 'div',
    name: id,
    visible: true,
    parentId,
    children,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    node: { id, type, visible: true } as unknown as SceneNode
  }
}

export function createTree(snapshots: NodeSnapshot[]): VisibleTree {
  return {
    rootIds: snapshots.filter((item) => !item.parentId).map((item) => item.id),
    order: snapshots.map((item) => item.id),
    stats: {
      totalNodes: snapshots.length,
      maxDepth: 1,
      capped: false,
      cappedNodeIds: []
    },
    nodes: new Map(snapshots.map((item) => [item.id, item]))
  }
}
