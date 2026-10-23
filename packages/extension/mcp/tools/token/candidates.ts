import type { FigmaLookupReaders } from '@/utils/figma-style/types'

import { collectNodeVariableIdsInto } from '@/utils/figma-variables'
import { logger } from '@/utils/log'

const DEFAULT_READERS: FigmaLookupReaders = {
  getStyleById: (id: string) => figma.getStyleById(id),
  getVariableById: (id: string) => figma.variables.getVariableById(id)
}

type CandidateOptions = {
  checkpoint?: () => void
  traverseChildren?: boolean
  captureNodeId?: (nodeId: string) => boolean
  onNodeVariableIds?: (nodeId: string, ids: ReadonlySet<string>) => void
}

function hasChildren(node: SceneNode): node is SceneNode & ChildrenMixin {
  return 'children' in node
}

export function collectCandidateVariableIds(
  roots: SceneNode[],
  readers: FigmaLookupReaders = DEFAULT_READERS,
  options: CandidateOptions = {}
): Set<string> {
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const startedAt = now()
  const variableIds = new Set<string>()

  const visit = (node: SceneNode) => {
    options.checkpoint?.()
    if (options.onNodeVariableIds && (options.captureNodeId?.(node.id) ?? true)) {
      const nodeIds = new Set<string>()
      collectNodeVariableIdsInto(node, nodeIds, readers, options.checkpoint)
      for (const id of nodeIds) variableIds.add(id)
      options.onNodeVariableIds(node.id, nodeIds)
    } else {
      collectNodeVariableIdsInto(node, variableIds, readers, options.checkpoint)
    }
    options.checkpoint?.()

    if (options.traverseChildren !== false && hasChildren(node)) {
      node.children.forEach((child) => {
        options.checkpoint?.()
        if (child.visible) visit(child)
      })
    }
  }

  roots.forEach((root) => {
    options.checkpoint?.()
    if (root.visible) visit(root)
  })

  options.checkpoint?.()
  const total = Math.round((now() - startedAt) * 10) / 10
  logger.debug(`vars scan=${total}ms ids=${variableIds.size}`)

  return variableIds
}
