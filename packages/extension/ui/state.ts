import { useStorage, computedAsync } from '@vueuse/core'
import { shallowRef } from 'vue'

import { getTemPadComponent } from '@/utils'

import { ui } from './figma'

interface PluginData {
  name: string
  code: string
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
  mcpOn: boolean
  plugins: {
    [source: string]: PluginData
  }
  activePluginSource: string | null
}

export const options = useStorage<Options>('tempad-dev', {
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
  mcpOn: false,
  plugins: {},
  activePluginSource: null
})

export const runtimeMode = shallowRef<'standard' | 'unavailable'>('standard')
export const layoutReady = shallowRef(false)
export const selection = shallowRef<readonly SceneNode[]>([])
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => getTemPadComponent(selectedNode.value))

export const activePlugin = computedAsync(async () => {
  if (!options.value.activePluginSource) {
    return null
  }

  return options.value.plugins[options.value.activePluginSource]
}, null)
