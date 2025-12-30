import { useDocumentVisibility, useEventListener, useWindowFocus } from '@vueuse/core'
import { computed, shallowRef, watch } from 'vue'

import { layoutReady, selection, runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

function isSameSelection(next: readonly SceneNode[], current: readonly SceneNode[]): boolean {
  if (next === current) return true
  if (next.length !== current.length) return false
  for (let i = 0; i < next.length; i += 1) {
    if (next[i]?.id !== current[i]?.id) return false
  }
  return true
}

export function syncSelection() {
  if (!window.figma?.currentPage) {
    if (selection.value.length) {
      selection.value = []
    }
    return
  }
  const next = figma.currentPage.selection
  if (!isSameSelection(next, selection.value)) {
    selection.value = next
  }
}

function handleClick() {
  syncSelection()
}

function handleKeyDown(e: KeyboardEvent) {
  if ((e.target as Element).classList.contains('focus-target')) {
    // command + A or other shortcut that changes selection
    syncSelection()
  }
}

export function useSelection() {
  const canvas = shallowRef<HTMLElement | null>(null)
  const objectsPanel = shallowRef<HTMLElement | null>(null)
  const documentVisibility = useDocumentVisibility()
  const focused = useWindowFocus()
  const isWindowActive = computed(() => documentVisibility.value === 'visible' && focused.value)

  const options = { capture: true }

  function syncTargets() {
    canvas.value = getCanvas()
    objectsPanel.value = getLeftPanel()
  }

  onMounted(() => {
    if (layoutReady.value) {
      syncTargets()
      syncSelection()
    }

    useEventListener(canvas, 'click', handleClick, options)
    useEventListener(objectsPanel, 'click', handleClick, options)
    useEventListener(window, 'keydown', handleKeyDown, options)
  })

  watch(
    layoutReady,
    (ready) => {
      if (ready) {
        syncTargets()
        return
      }
      canvas.value = null
      objectsPanel.value = null
      if (selection.value.length) {
        selection.value = []
      }
    },
    { immediate: true }
  )

  watch([runtimeMode, isWindowActive], ([mode, active]) => {
    if (mode !== 'standard') return
    if (!layoutReady.value) return
    if (active) syncSelection()
  })
}
