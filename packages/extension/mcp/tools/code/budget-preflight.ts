import { utf8Bytes } from '@tempad-dev/shared'

import type { VisibleTree } from './model'

export function preflightGetCodeBudget(
  tree: VisibleTree,
  rootId: string,
  options: {
    maxResultBytes: number
    pluginEnabled: boolean
    unbounded: boolean
  }
): { kind: 'full' } | { kind: 'shell'; scannedDescendants: number } {
  const root = tree.nodes.get(rootId)
  if (
    options.unbounded ||
    options.pluginEnabled ||
    !root?.children.length ||
    root.node.type === 'TEXT' ||
    root.assetKind === 'vector'
  ) {
    return { kind: 'full' }
  }

  let textBytes = 0
  let scannedDescendants = 0
  for (const id of tree.order) {
    if (id === rootId) continue
    scannedDescendants += 1
    const node = tree.nodes.get(id)?.node
    if (node?.type !== 'TEXT') continue
    textBytes += utf8Bytes(node.characters)
    if (textBytes > options.maxResultBytes) return { kind: 'shell', scannedDescendants }
  }

  return { kind: 'full' }
}
