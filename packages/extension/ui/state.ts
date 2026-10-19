import { useStorage, computedAsync, useEventListener } from '@vueuse/core'
import { computed, shallowRef } from 'vue'

import { getTemPadComponent } from '@/utils'
import { logger } from '@/utils/log'

import { ui } from './figma'
import { createPluginStorage, PLUGIN_STORAGE_KEY, type PluginData } from './plugin-storage'
import { createPreferenceStorage } from './preference-storage'

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
  createPreferenceStorage(localStorage, navigator.locks, (error) => {
    logger.error('Failed to persist preferences:', error)
  }),
  { mergeDefaults: true, listenToStorageChanges: false }
)

const pluginStorage = createPluginStorage(localStorage, navigator.locks)
export const plugins = shallowRef<Record<string, PluginData>>({})

function publishPlugins(current: ReturnType<typeof pluginStorage.read>) {
  plugins.value = current.plugins
  const preferences = options.value as Options & { plugins?: typeof plugins.value }
  if (!current.legacy) delete preferences.plugins
}

function refreshPlugins() {
  try {
    publishPlugins(pluginStorage.read())
  } catch (error) {
    logger.error('Failed to read plugin storage:', error)
  }
}

refreshPlugins()
void pluginStorage
  .migrate()
  .then(refreshPlugins)
  .catch((error) => {
    logger.error('Failed to migrate plugin storage:', error)
  })
useEventListener(window, 'storage', (event) => {
  if (
    event.storageArea === localStorage &&
    (event.key === null ||
      event.key === PLUGIN_STORAGE_KEY ||
      (event.key === 'tempad-dev' && localStorage.getItem(PLUGIN_STORAGE_KEY) === null))
  ) {
    // Events can arrive after a newer write. Read the durable state, not newValue.
    refreshPlugins()
  }
})

export async function savePlugin(source: string, plugin: PluginData | null): Promise<void> {
  await pluginStorage.save(source, plugin)
  publishPlugins(pluginStorage.read())
}

if (!Number.isFinite(options.value.rootFontSize) || options.value.rootFontSize <= 0)
  options.value.rootFontSize = 16
if (!Number.isFinite(options.value.scale) || options.value.scale <= 0) options.value.scale = 1

export const runtimeMode = shallowRef<'standard' | 'unavailable'>('standard')
export const layoutReady = shallowRef(false)
export const selection = shallowRef<readonly SceneNode[]>([])
export const selectionRevision = shallowRef(0)
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => {
  // Native nodes are mutable even while the selected IDs stay unchanged.
  void selectionRevision.value
  const node = selectedNode.value
  return node ? getTemPadComponent(node) : null
})

export const activePlugin = computedAsync(async () => {
  if (!options.value.activePluginSource) {
    return null
  }

  return plugins.value[options.value.activePluginSource]
}, null)
