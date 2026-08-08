import type { CanvasDesignReference } from '@tempad-dev/shared'

import { specError } from './errors'
import { isInsideInstance } from './traversal'

export const CANVAS_KEY_NAMESPACE = 'tempad_dev'
export const CANVAS_NODE_KEY_NAME = 'canvas-key'
export const CANVAS_NODE_OWNER_NAME = 'canvas-owner'
export const CANVAS_PAGE_KEY_NAME = 'page-key'
export const CANVAS_STYLE_KEY_NAME = 'style-key'
export const CANVAS_VARIABLE_COLLECTION_KEY_NAME = 'variable-collection-key'
export const CANVAS_VARIABLE_KEY_NAME = 'variable-key'
export const CANVAS_VARIABLE_MODE_KEYS_NAME = 'variable-mode-keys'

export type MutationCounter = { count: number }

export function designReferenceCacheKey(reference: CanvasDesignReference): string {
  return reference.id !== undefined ? `id:${reference.id}` : `key:${reference.key}`
}

export function readAuthoringKey(
  resource: {
    getSharedPluginData?: (namespace: string, key: string) => string
  },
  name: string
): string | undefined {
  const key = resource.getSharedPluginData?.(CANVAS_KEY_NAMESPACE, name)
  return key || undefined
}

export function readOwnedNodeKey(node: SceneNode): string | undefined {
  if (isInsideInstance(node)) return undefined
  const key = readAuthoringKey(node, CANVAS_NODE_KEY_NAME)
  if (!key || node.type !== 'INSTANCE') return key

  const owner = readAuthoringKey(node, CANVAS_NODE_OWNER_NAME)
  if (owner) return owner === node.id ? key : undefined

  try {
    const component = node.mainComponent
    if (!component) return undefined
    const definitionKey = readAuthoringKey(component, CANVAS_NODE_KEY_NAME)
    return definitionKey === key ? undefined : key
  } catch {
    return undefined
  }
}

export function claimNodeKey(node: SceneNode, key: string): boolean {
  if (isInsideInstance(node)) {
    specError(`Node "${node.id}" is inside an instance and cannot own a canvas key.`)
  }
  const current = readOwnedNodeKey(node)
  const owner = readAuthoringKey(node, CANVAS_NODE_OWNER_NAME)
  if (current && current !== key) {
    specError(`Node "${node.id}" is already owned by canvas key "${current}".`)
  }

  const keyChanged = current !== key
  const ownerChanged = node.type === 'INSTANCE' && owner !== node.id
  if (keyChanged) node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_KEY_NAME, key)
  if (ownerChanged) {
    node.setSharedPluginData(CANVAS_KEY_NAMESPACE, CANVAS_NODE_OWNER_NAME, node.id)
  }
  return keyChanged || ownerChanged
}

export function claimAuthoringKey(
  resource: {
    id: string
    getSharedPluginData: (namespace: string, key: string) => string
    setSharedPluginData: (namespace: string, key: string, value: string) => void
  },
  key: string,
  name: string,
  label: string,
  mutations: MutationCounter
): void {
  const current = readAuthoringKey(resource, name)
  if (current === key) return
  if (current) {
    specError(`${label} "${resource.id}" is already owned by authoring key "${current}".`)
  }
  resource.setSharedPluginData(CANVAS_KEY_NAMESPACE, name, key)
  mutations.count += 1
}

export function parseVariableModeKeys(
  raw: string,
  modes: readonly { modeId: string }[]
): Map<string, string> | null {
  if (!raw) return new Map()
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      Object.entries(parsed).some(([key, value]) => !key || typeof value !== 'string' || !value)
    ) {
      return null
    }
    const liveIds = new Set(modes.map((mode) => mode.modeId))
    const keys = new Map(
      Object.entries(parsed as Record<string, string>).filter(([, id]) => liveIds.has(id))
    )
    return new Set(keys.values()).size === keys.size ? keys : null
  } catch {
    return null
  }
}
