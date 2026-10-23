import type { GetTokenDefsResult, TokenEntry } from '@tempad-dev/shared'

import {
  MCP_TOOL_INLINE_BUDGET_BYTES,
  buildGetTokenDefsToolResult,
  measureCallToolResultBytes
} from '@tempad-dev/shared'

import type { CodegenConfig } from '@/utils/codegen'

import { activePlugin } from '@/ui/state'
import { logger } from '@/utils/log'

import type { TokenReadContext } from './context'

import { currentCodegenConfig } from '../config'
import { createTokenReadContext } from './context'
import {
  isVariableAlias,
  pickPreferredModeId,
  readActiveModeId,
  serializeVariableValue
} from './value'

export async function handleGetTokenDefs(
  names: string[],
  includeAllModes = false
): Promise<GetTokenDefsResult> {
  const requested = new Set(names.map((name) => (name.startsWith('--') ? name : `--${name}`)))
  const tokens = await resolveTokenDefsByNames(
    requested,
    currentCodegenConfig(),
    activePlugin.value?.code,
    { includeAllModes }
  )
  if (
    measureCallToolResultBytes(buildGetTokenDefsToolResult(tokens)) > MCP_TOOL_INLINE_BUDGET_BYTES
  ) {
    throw new Error(
      'Token tool result exceeded the 64 KiB inline budget. Reduce requested names or split into smaller batches and retry.'
    )
  }
  return tokens
}

export async function resolveTokenDefsByNames(
  names: Set<string>,
  config: CodegenConfig,
  pluginCode?: string,
  options: { includeAllModes?: boolean } = {}
): Promise<GetTokenDefsResult> {
  if (!names.size) return {}
  const context = createTokenReadContext(config, pluginCode)
  const index = await context.getIndex()
  const seeds = new Map<string, string>()
  for (const name of names) {
    const ids = index.byCanonicalName.get(name)
    if (!ids?.length) continue
    if (ids.length > 1) {
      throw new Error(
        `Token name "${name}" matches multiple variables. Use unique variable or transformed names.`
      )
    }
    const id = ids[0]!
    seeds.set(index.canonicalNameById.get(id) ?? name, id)
  }
  return resolveTokenDefsByIds(seeds, context, !!options.includeAllModes)
}

// Code reads already know exact variable IDs. Resolve only those definitions and alias
// dependencies; a file-wide name index would both lose identity and do unnecessary work.
export async function resolveTokenDefsByIds(
  seeds: Map<string, string>,
  context: TokenReadContext,
  includeAllModes = true,
  report: (message: string) => void = (message) => logger.warn(message),
  checkpoint?: () => void
): Promise<GetTokenDefsResult> {
  checkpoint?.()
  const tokens: GetTokenDefsResult = {}
  const namesById = new Map(Array.from(seeds, ([name, id]) => [id, name]))
  const idsByName = new Map<string, string | null>()
  const collectionIdsByName = new Map<string, string>()
  const pending = [...seeds.values()]
  const closure = new Map<string, Variable>()
  const attempted = new Set<string>()
  const closurePending = [...pending]
  for (let index = 0; index < closurePending.length; index++) {
    checkpoint?.()
    const id = closurePending[index]!
    if (attempted.has(id)) continue
    attempted.add(id)
    const variable = context.getVariable(id)
    checkpoint?.()
    if (!variable) continue
    closure.set(id, variable)
    for (const value of Object.values(variable.valuesByMode)) {
      checkpoint?.()
      if (isVariableAlias(value) && !attempted.has(value.id)) closurePending.push(value.id)
    }
  }
  await context.prepareNames(
    [...closure.values()].filter((variable) => {
      checkpoint?.()
      return !namesById.has(variable.id)
    }),
    checkpoint
  )
  checkpoint?.()
  const seen = new Set<string>()
  const nameOf = async (variable: Variable) => {
    checkpoint?.()
    let name = namesById.get(variable.id)
    if (!name) {
      name = await context.getName(variable, checkpoint)
      checkpoint?.()
      namesById.set(variable.id, name)
    }
    const previous = idsByName.get(name)
    if (previous !== undefined && previous !== variable.id) {
      idsByName.set(name, null)
      delete tokens[name]
      report(`Token name "${name}" matches multiple variables.`)
    } else {
      idsByName.set(name, variable.id)
    }
    return name
  }

  for (let i = 0; i < pending.length; i += 1) {
    checkpoint?.()
    const id = pending[i]!
    if (seen.has(id)) continue
    seen.add(id)
    const variable = context.getVariable(id)
    checkpoint?.()
    if (!variable) {
      report(`Variable ${id} is unavailable.`)
      continue
    }
    const name = await nameOf(variable)
    checkpoint?.()
    const collection = context.getCollection(variable.variableCollectionId)
    checkpoint?.()
    if (!collection) {
      report(`Collection ${variable.variableCollectionId} for variable ${id} is unavailable.`)
    } else {
      const previous = collectionIdsByName.get(collection.name)
      if (previous && previous !== collection.id) {
        report(`Duplicate collection name "${collection.name}"; mode labels are ambiguous.`)
      }
      collectionIdsByName.set(collection.name, collection.id)
    }
    const preferred = pickPreferredModeId(variable, {
      defaultModeId: collection?.defaultModeId,
      activeModeId: includeAllModes ? undefined : readActiveModeId(collection?.id)
    })
    const modeIds = includeAllModes
      ? Object.keys(variable.valuesByMode)
      : preferred
        ? [preferred]
        : []
    const values: Record<string, string> = {}
    for (const modeId of modeIds) {
      checkpoint?.()
      const raw = variable.valuesByMode[modeId]
      let value: string | null = null
      if (isVariableAlias(raw)) {
        const target = context.getVariable(raw.id)
        checkpoint?.()
        if (target) {
          value = await nameOf(target)
          checkpoint?.()
          pending.push(target.id)
        } else {
          report(`Alias target ${raw.id} for variable ${id} is unavailable.`)
        }
      } else {
        const scopes = variable.scopes
        const unitless =
          scopes?.length && scopes.every((scope) => scope === 'FONT_WEIGHT' || scope === 'OPACITY')
            ? true
            : undefined
        const serialized = serializeVariableValue(
          raw,
          variable.resolvedType,
          context.config,
          name,
          unitless,
          true
        )
        if (typeof serialized === 'string') value = serialized
      }
      if (value === null) {
        report(`Variable ${id}, mode ${modeId} has no usable definition.`)
        continue
      }
      const mode = collection?.modes.find((mode) => mode.modeId === modeId)
      if (collection && !mode) {
        report(`Mode ${modeId} in collection ${collection.id} is unavailable; definitions use IDs.`)
      }
      const modeName = mode?.name ?? modeId
      const key = collection?.name ? `${collection.name}:${modeName}` : modeName
      if (key in values) {
        report(`Variable ${id} has duplicate mode label "${key}".`)
        continue
      }
      values[key] = value
    }
    checkpoint?.()
    if (Object.keys(values).length && idsByName.get(name) === id) {
      tokens[name] = {
        kind: mapResolvedType(variable.resolvedType),
        value: modeIds.length > 1 ? values : Object.values(values)[0]!
      }
    }
  }
  checkpoint?.()
  return tokens
}

function mapResolvedType(type: Variable['resolvedType']): TokenEntry['kind'] {
  switch (type) {
    case 'COLOR':
      return 'color'
    case 'FLOAT':
      return 'number'
    case 'BOOLEAN':
      return 'boolean'
    case 'STRING':
      return 'string'
    default:
      return 'string'
  }
}
