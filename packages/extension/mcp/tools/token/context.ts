import type { CodegenConfig } from '@/utils/codegen'

import { getVariableByIdCached } from './cache'
import { canonicalizeName, getTokenIndex, getVariableRawName } from './indexer'

export type ConsumerValue = ReturnType<Variable['resolveForConsumer']> | null

// Created once per tool call. Raw consumer values are separate from CSS serialization.
export type TokenReadContext = ReturnType<typeof createTokenReadContext>

export function createTokenReadContext(
  config: CodegenConfig,
  pluginCode?: string,
  variables = new Map<string, Variable | null>()
) {
  const collections = new Map<string, VariableCollection | null>()
  const names = new Map<string, Promise<string>>()
  const consumerValues = new Map<string, Map<string, ConsumerValue>>()
  let index: ReturnType<typeof getTokenIndex> | undefined
  const snapshot = { ...config }

  return {
    config: snapshot,
    pluginCode,
    variables,
    consumerValues,
    getVariable(id: string): Variable | null {
      try {
        return getVariableByIdCached(id, variables)
      } catch {
        variables.set(id, null)
        return null
      }
    },
    getCollection(id: string): VariableCollection | null {
      if (!collections.has(id)) {
        try {
          collections.set(id, figma.variables.getVariableCollectionById(id))
        } catch {
          collections.set(id, null)
        }
      }
      return collections.get(id) ?? null
    },
    getName(variable: Variable): Promise<string> {
      let name = names.get(variable.id)
      if (!name) {
        name = canonicalizeName(getVariableRawName(variable), snapshot, pluginCode)
        names.set(variable.id, name)
      }
      return name
    },
    getIndex() {
      return (index ??= getTokenIndex(snapshot, pluginCode).then((result) => {
        for (const [id, name] of result.canonicalNameById) {
          names.set(id, Promise.resolve(name))
        }
        return result
      }))
    }
  }
}
