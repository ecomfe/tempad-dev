import { useDocumentVisibility, useEventListener, useWindowFocus } from '@vueuse/core'
import { computed, onMounted, shallowRef, watch } from 'vue'

import { readFigmaFileKey } from '@/mcp/figma-session'
import { layoutReady, selection, runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

let selectionFileKey: string | null = null

function isSameSelection(next: readonly SceneNode[], current: readonly SceneNode[]): boolean {
  if (next.length !== current.length) return false
  for (let i = 0; i < next.length; i += 1) {
    if (next[i]?.id !== current[i]?.id) return false
  }
  return true
}

export function syncSelection() {
  const api = window.figma
  if (!api?.currentPage) {
    selectionFileKey = null
    if (selection.value.length) {
      selection.value = []
    }
    return
  }
  const fileKey = readFigmaFileKey(api)
  const next = api.currentPage.selection
  // Node IDs are file-local. Keep same-file wrappers stable, but never retain a
  // previous document's node (and its resources) when the selected IDs coincide.
  if (selectionFileKey !== fileKey || !isSameSelection(next, selection.value)) {
    selection.value = next
  }
  selectionFileKey = fileKey
}

function handleClick() {
  syncSelection()
}

function handleKeyDown(e: KeyboardEvent) {
  const target = e.target as Element | null
  if (target?.classList.contains('focus-target')) {
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
