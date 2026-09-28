import type { TokenReadContext } from '../../token/context'
import type { VisibleTree } from '../model'
import type { ReportTokenDiagnostic } from './diagnostics'

import { isVariableAlias } from '../../token/value'

// Only collections reachable from this root's variable candidates belong in its mode hints.
// IDs carry identity throughout; names are presentation labels only.
export function addVariableModeHints(
  tree: VisibleTree,
  variableIds: Set<string>,
  context: TokenReadContext,
  report: ReportTokenDiagnostic
): void {
  const collections = new Map<string, VariableCollection | null>()
  const seen = new Set<string>()
  const pending = [...variableIds]
  for (let i = 0; i < pending.length; i += 1) {
    const id = pending[i]!
    if (seen.has(id)) continue
    seen.add(id)
    const variable = context.getVariable(id)
    if (!variable) continue
    collections.set(
      variable.variableCollectionId,
      context.getCollection(variable.variableCollectionId)
    )
    for (const value of Object.values(variable.valuesByMode)) {
      if (isVariableAlias(value)) pending.push(value.id)
    }
  }

  const idsByName = new Map<string, string>()
  const ambiguous = new Set<string>()
  for (const [id, collection] of collections) {
    if (!collection) {
      report('token-definition', `Collection ${id} is unavailable; mode hints use IDs.`)
      continue
    }
    const previous = idsByName.get(collection.name)
    if (previous && previous !== id) {
      ambiguous.add(collection.name)
      report(
        'token-definition',
        `Duplicate collection name "${collection.name}"; mode hints use IDs.`
      )
    }
    idsByName.set(collection.name, id)
  }

  const rootIds = new Set(tree.rootIds)
  for (const snapshot of tree.nodes.values()) {
    const node = snapshot.node
    const modes = rootIds.has(node.id) ? node.resolvedVariableModes : node.explicitVariableModes
    const parts = Object.entries(modes ?? {})
      .filter(([id]) => collections.has(id))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, modeId]) => {
        const collection = collections.get(id)
        const name = collection && !ambiguous.has(collection.name) ? collection.name : id
        const modeName = collection?.modes.find((mode) => mode.modeId === modeId)?.name ?? modeId
        return `${name}=${modeName}`
      })
    if (!parts.length) continue
    snapshot.dataHint ??= {}
    snapshot.dataHint['data-hint-variable-mode'] = parts.join(';')
  }
}
