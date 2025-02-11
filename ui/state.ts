import { getTemPadComponent } from '@/utils'
import { useStorage, computedAsync } from '@vueuse/core'

import type { QuirksNode, GhostNode } from './quirks'

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
  }
  prefOpen: boolean
  deepSelectOn: boolean
  measureOn: boolean
  cssUnit: 'px' | 'rem'
  rootFontSize: number
  scale: number
  plugins: {
    [source: string]: PluginData
  }
  activePluginSource: string | null
}

export type SelectionNode = SceneNode | QuirksNode | GhostNode

export const options = useStorage<Options>('tempad-dev', {
  minimized: false,
  panelPosition: {
    left: window.innerWidth - ui.nativePanelWidth - ui.tempadPanelWidth,
    top: ui.topBoundary
  },
  prefOpen: false,
  deepSelectOn: false,
  measureOn: false,
  cssUnit: 'px',
  rootFontSize: 16,
  scale: 1,
  plugins: {},
  activePluginSource: null
})

export const isQuirksMode = shallowRef<boolean>(false)
export const selection = shallowRef<readonly SelectionNode[]>([])
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => getTemPadComponent(selectedNode.value))

export const activePlugin = computedAsync(async () => {
  if (!options.value.activePluginSource) {
    return null
  }

  return options.value.plugins[options.value.activePluginSource]
}, null)
