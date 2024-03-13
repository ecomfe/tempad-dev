import { shallowRef, computed } from 'vue'
import { useStorage } from '@vueuse/core'
import { NATIVE_PANEL_WIDTH, PANEL_WIDTH, TOOLBAR_HEIGHT } from './const'

export const options = useStorage('tempad-dev', {
  minimized: false,
  panelPosition: {
    left: window.innerWidth - NATIVE_PANEL_WIDTH - PANEL_WIDTH,
    top: TOOLBAR_HEIGHT
  },
  prefOpen: false,
  deepSelectOn: false,
  measureOn: false
})

export const selection = shallowRef<readonly SceneNode[] | null>(null)
export const selectedNode = computed(() => selection.value?.[0] ?? null)
