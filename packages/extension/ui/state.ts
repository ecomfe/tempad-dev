import { useStorage, computedAsync } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

import { getTemPadComponent } from '@/utils'
import { logger } from '@/utils/log'

import { ui } from './figma'
import { createPreferenceStorage } from './preference-storage'

interface PluginData {
  name: string
  code: string
  integrity?: string
  resolvedUrl?: string
  source: string
}

export type Options = {
  minimized: boolean
  panelPosition: {
    left: number
    top: number
    width?: number
  }
  prefOpen: boolean
  deepSelectOn: boolean
  measureOn: boolean
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
  variableDisplay: 'reference' | 'resolved' | 'both'
  mcpOn: boolean
  activePluginSource: string | null
}

export const options = useStorage<Options>(
  'tempad-dev',
  {
    minimized: false,
    panelPosition: {
      left: window.innerWidth - ui.nativePanelWidth - ui.tempadPanelWidth,
      top: ui.topBoundary,
      width: ui.tempadPanelWidth
    },
    prefOpen: false,
    deepSelectOn: false,
    measureOn: false,
    cssUnit: 'px',
    rootFontSize: 16,
    scale: 1,
    variableDisplay: 'reference',
    mcpOn: false,
    activePluginSource: null
  },
  createPreferenceStorage(localStorage),
  { mergeDefaults: true, listenToStorageChanges: false }
)

// Migrate the old combined record once before removing plugin code from preferences.
const legacy = options.value as Options & { plugins?: Record<string, PluginData> }
const PLUGIN_STORAGE_KEY = 'tempad-dev-plugins'
let pluginStorageFailed = false
export const plugins = useStorage<Record<string, PluginData>>(
  PLUGIN_STORAGE_KEY,
  legacy.plugins ?? {},
  undefined,
  {
    listenToStorageChanges: false,
    onError(error) {
      pluginStorageFailed = true
      logger.error('Failed to persist plugin storage:', error)
    }
  }
)
if (!pluginStorageFailed) delete legacy.plugins

export function savePlugin(source: string, plugin: PluginData | null): void {
  const next = { ...plugins.value }
  if (plugin) next[source] = plugin
  else delete next[source]

  // Commit before publishing: useStorage reports asynchronous write errors without
  // rolling back its ref. Its later watcher skips this already-persisted value.
  try {
    localStorage.setItem(PLUGIN_STORAGE_KEY, JSON.stringify(next))
  } catch (error) {
    const preferences = options.value as typeof legacy
    // A shrinking legacy record can free space without temporarily duplicating its code.
    // Replacing one key is atomic; a failed write leaves the only durable copy intact.
    if (plugin || !preferences.plugins) throw error
    const stored = JSON.parse(localStorage.getItem('tempad-dev') ?? '{}')
    localStorage.setItem('tempad-dev', JSON.stringify({ ...stored, plugins: next }))
    preferences.plugins = next
    plugins.value = next
    return
  }
  plugins.value = next
  // Finish a migration that previously retained its backup after a storage error.
  delete (options.value as typeof legacy).plugins
}

if (!Number.isFinite(options.value.rootFontSize) || options.value.rootFontSize <= 0)
  options.value.rootFontSize = 16
if (!Number.isFinite(options.value.scale) || options.value.scale <= 0) options.value.scale = 1

export const runtimeMode = shallowRef<'standard' | 'unavailable'>('standard')
export const layoutReady = shallowRef(false)
export const selection = shallowRef<readonly SceneNode[]>([])
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => {
  const node = selectedNode.value
  return node ? getTemPadComponent(node) : null
})

export const activePlugin = computedAsync(async () => {
  if (!options.value.activePluginSource) {
    return null
  }

  return plugins.value[options.value.activePluginSource]
}, null)
