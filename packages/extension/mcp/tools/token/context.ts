import type { CodegenConfig } from '@/utils/codegen'

import { getVariableByIdCached } from './cache'
import { canonicalizeName, canonicalizeNames, getTokenIndex, getVariableRawName } from './indexer'

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
    async getName(variable: Variable, checkpoint?: () => void): Promise<string> {
      checkpoint?.()
      let name = names.get(variable.id)
      if (!name) {
        const rawName = getVariableRawName(variable)
        checkpoint?.()
        // Pending name reads can be shared by full and shell attempts. Keep the
        // cached work independent of either caller's deadline.
        name = canonicalizeName(rawName, snapshot, pluginCode)
        names.set(variable.id, name)
      }
      let value: string
      try {
        value = await name
      } catch (error) {
        if (names.get(variable.id) === name) names.delete(variable.id)
        throw error
      }
      checkpoint?.()
      return value
    },
    async prepareNames(variables: Variable[], checkpoint?: () => void): Promise<void> {
      checkpoint?.()
      const missing = variables.filter((variable) => {
        checkpoint?.()
        return !names.has(variable.id)
      })
      if (!missing.length) return
      const rawNames = missing.map((variable) => {
        checkpoint?.()
        return getVariableRawName(variable)
      })
      const values = await canonicalizeNames(rawNames, snapshot, pluginCode, checkpoint)
      checkpoint?.()
      missing.forEach((variable, index) => {
        checkpoint?.()
        names.set(variable.id, Promise.resolve(values[index]!))
      })
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
