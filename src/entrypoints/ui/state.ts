import { shallowRef, computed, ref, watch } from 'vue'
import { useStorage, createGlobalState } from '@vueuse/core'
import { NATIVE_PANEL_WIDTH, PANEL_WIDTH, TOOLBAR_HEIGHT } from './const'
import { getTemPadComponent } from './utils'

export type ScaleSelectionType = {
  scale: string
  suffix: string
  fileType: 'PNG' | 'JPG' | 'SVG'
}

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
  exportOpen: boolean
}

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
  rootFontSize: 16,
  exportOpen: false
})

export const selection = shallowRef<readonly SceneNode[]>([])
export const selectedNode = computed(() => selection.value?.[0] ?? null)
export const selectedTemPadComponent = computed(() => getTemPadComponent(selectedNode.value))

export const useGlobalState = createGlobalState(() => {
  const scaleInputs = ref<ScaleSelectionType[]>([])

  function addScaleInput() {
    const scaleInputsLen = scaleInputs.value.length + 1
    scaleInputs.value.unshift({
      scale: `${scaleInputsLen > 4 ? '1' : scaleInputsLen}x`,
      fileType: 'PNG',
      suffix: ''
    })
  }

  function removeScaleInput(index: number) {
    scaleInputs.value.splice(index, 1)
  }

  watch(
    selectedNode,
    () => {
      scaleInputs.value = []
    },
    {
      immediate: true
    }
  )

  return { scaleInputs, addScaleInput, removeScaleInput }
})
