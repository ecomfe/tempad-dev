import { shallowRef, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { NATIVE_PANEL_WIDTH, PANEL_WIDTH, TOOLBAR_HEIGHT } from './const'
import { getTemPadComponent } from './utils'
import type { QuirksNode, GhostNode } from './utils/quirks'

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
    left: window.innerWidth - NATIVE_PANEL_WIDTH - PANEL_WIDTH,
    top: TOOLBAR_HEIGHT
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
