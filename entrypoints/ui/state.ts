import { useStorage } from '@vueuse/core'
import { ui } from './figma'
import { getTemPadComponent } from './utils'
import type { QuirksNode, GhostNode } from './quirks'

type Options = {
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
}

type SelectionNode = SceneNode | QuirksNode | GhostNode

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
  rootFontSize: 16
})

export const isQuirksMode = shallowRef<boolean>(false)
export const selection = shallowRef<readonly SelectionNode[]>([])
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => getTemPadComponent(selectedNode.value))
