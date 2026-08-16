import { retryAfterFigmaConnectionTimeout } from './figma-readiness'

async function readWithSyncFallback<T>(readAsync: () => Promise<T>, readSync: () => T): Promise<T> {
  try {
    return await readAsync()
  } catch (asyncError) {
    // The rewritten editor runtime can expose the Plugin API before its async backend is ready.
    try {
      return readSync()
    } catch (syncError) {
      return retryAfterFigmaConnectionTimeout(readAsync, asyncError, syncError)
    }
  }
}

export function getNodeById(id: string): Promise<BaseNode | null> {
  return readWithSyncFallback(
    () => figma.getNodeByIdAsync(id),
    () => figma.getNodeById(id)
  )
}

export function getCurrentContextNodeById(id: string): BaseNode | null {
  try {
    const node = figma.getNodeById(id)
    return node && !node.removed ? node : null
  } catch {
    return null
  }
}

export async function getMainComponent(instance: InstanceNode): Promise<ComponentNode | null> {
  try {
    const component = instance.mainComponent
    if (component && !component.removed) return component
  } catch {
    // Dynamic-page access can make the synchronous relationship unavailable.
  }
  return instance.getMainComponentAsync()
}

export function getStyleById(id: string): Promise<BaseStyle | null> {
  return readWithSyncFallback(
    () => figma.getStyleByIdAsync(id),
    () => figma.getStyleById(id)
  )
}

export function getVariableById(id: string): Promise<Variable | null> {
  return readWithSyncFallback(
    () => figma.variables.getVariableByIdAsync(id),
    () => figma.variables.getVariableById(id)
  )
}

export function getVariableCollectionById(id: string): Promise<VariableCollection | null> {
  return readWithSyncFallback(
    () => figma.variables.getVariableCollectionByIdAsync(id),
    () => figma.variables.getVariableCollectionById(id)
  )
}

export function getLocalVariables(): Promise<Variable[]> {
  return readWithSyncFallback(
    () => figma.variables.getLocalVariablesAsync(),
    () => figma.variables.getLocalVariables()
  )
}

export function getLocalVariableCollections(): Promise<VariableCollection[]> {
  return readWithSyncFallback(
    () => figma.variables.getLocalVariableCollectionsAsync(),
    () => figma.variables.getLocalVariableCollections()
  )
}

export function getLocalPaintStyles(): Promise<PaintStyle[]> {
  return readWithSyncFallback(
    () => figma.getLocalPaintStylesAsync(),
    () => figma.getLocalPaintStyles()
  )
}

export function getLocalTextStyles(): Promise<TextStyle[]> {
  return readWithSyncFallback(
    () => figma.getLocalTextStylesAsync(),
    () => figma.getLocalTextStyles()
  )
}

export function getLocalEffectStyles(): Promise<EffectStyle[]> {
  return readWithSyncFallback(
    () => figma.getLocalEffectStylesAsync(),
    () => figma.getLocalEffectStyles()
  )
}

export function getLocalGridStyles(): Promise<GridStyle[]> {
  return readWithSyncFallback(
    () => figma.getLocalGridStylesAsync(),
    () => figma.getLocalGridStyles()
  )
}

export async function getLocalStyles(): Promise<BaseStyle[]> {
  return (
    await Promise.all([
      getLocalPaintStyles(),
      getLocalTextStyles(),
      getLocalEffectStyles(),
      getLocalGridStyles()
    ])
  ).flat()
}
