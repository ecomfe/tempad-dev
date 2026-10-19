import { useDocumentVisibility, useEventListener, useWindowFocus } from '@vueuse/core'
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'

import { readFigmaFileKey } from '@/mcp/figma-session'
import { layoutReady, selection, selectionRevision, runtimeMode } from '@/ui/state'
import { getCanvas, getLeftPanel } from '@/utils'

let selectionFileKey: string | null = null

function isSameSelection(next: readonly SceneNode[], current: readonly SceneNode[]): boolean {
  if (next.length !== current.length) return false
  for (let i = 0; i < next.length; i += 1) {
    if (next[i]?.id !== current[i]?.id) return false
  }
  return true
}

function readPageSelection(api: PluginAPI | undefined) {
  try {
    const page = api?.currentPage
    return page ? { page, nodes: page.selection } : undefined
  } catch {
    return undefined
  }
}

export function syncSelection() {
  const api = window.figma
  const snapshot = readPageSelection(api)
  if (!snapshot) {
    selectionFileKey = null
    if (selection.value.length) {
      selection.value = []
    }
    return
  }
  const fileKey = readFigmaFileKey(api)
  const next = snapshot.nodes
  // Node IDs are file-local. Keep same-file wrappers stable, but never retain a
  // previous document's node (and its resources) when the selected IDs coincide.
  if (selectionFileKey !== fileKey || !isSameSelection(next, selection.value)) {
    selection.value = next
  }
  selectionFileKey = fileKey
  selectionRevision.value++
}

export function useSelection() {
  const canvas = shallowRef<HTMLElement | null>(null)
  const objectsPanel = shallowRef<HTMLElement | null>(null)
  const documentVisibility = useDocumentVisibility()
  const focused = useWindowFocus()
  const isWindowActive = computed(() => documentVisibility.value === 'visible' && focused.value)

  const options = { capture: true }
  let disposed = false
  let refreshTimer: ReturnType<typeof setTimeout> | undefined
  let observedApi: PluginAPI | undefined
  let observedPage: PageNode | undefined
  const nativeListeners: Array<() => void> = []

  function syncTargets() {
    canvas.value = getCanvas()
    objectsPanel.value = getLeftPanel()
  }

  function removeNativeListeners() {
    for (const remove of nativeListeners.splice(0)) {
      try {
        remove()
      } catch {
        // A previous document's native API may already be unavailable.
      }
    }
    observedApi = undefined
    observedPage = undefined
  }

  function subscribe(add: () => void, remove: () => void) {
    try {
      add()
      nativeListeners.push(remove)
    } catch {
      // Runtime builds without native event support use the DOM/focus fallback.
    }
  }

  function syncNativeListeners() {
    const api = layoutReady.value && runtimeMode.value === 'standard' ? window.figma : undefined
    const page = readPageSelection(api)?.page
    if (api === observedApi && page === observedPage) return
    removeNativeListeners()
    observedApi = api
    observedPage = page
    if (api && typeof api.on === 'function' && typeof api.off === 'function') {
      subscribe(
        () => api.on('selectionchange', scheduleRefresh),
        () => api.off('selectionchange', scheduleRefresh)
      )
      subscribe(
        () => api.on('currentpagechange', scheduleRefresh),
        () => api.off('currentpagechange', scheduleRefresh)
      )
      subscribe(
        () => api.on('stylechange', scheduleRefresh),
        () => api.off('stylechange', scheduleRefresh)
      )
    }
    if (page && typeof page.on === 'function' && typeof page.off === 'function') {
      subscribe(
        () => page.on('nodechange', scheduleRefresh),
        () => page.off('nodechange', scheduleRefresh)
      )
    }
  }

  function scheduleRefresh() {
    clearTimeout(refreshTimer)
    if (disposed || !layoutReady.value || runtimeMode.value !== 'standard' || !isWindowActive.value)
      return
    // Read after Figma's event handlers and coalesce drag, typing and native batches.
    refreshTimer = setTimeout(() => {
      syncNativeListeners()
      syncSelection()
    }, 100)
  }

  function handleEdit(event: Event) {
    const target = event.target as Element | null
    if (target?.closest?.('tempad')) return
    if ('key' in event && /^(Alt|Control|Meta|Shift| )$/.test(String(event.key))) return
    scheduleRefresh()
  }

  onMounted(() => {
    useEventListener(canvas, 'click', handleEdit, options)
    useEventListener(objectsPanel, 'click', handleEdit, options)
    for (const event of ['pointerup', 'keyup', 'input', 'change'] as const) {
      useEventListener(window, event, handleEdit, options)
    }
  })

  watch(
    layoutReady,
    (ready) => {
      if (ready) {
        syncTargets()
        syncNativeListeners()
        if (runtimeMode.value === 'standard') syncSelection()
        return
      }
      clearTimeout(refreshTimer)
      removeNativeListeners()
      canvas.value = null
      objectsPanel.value = null
      if (selection.value.length) {
        selection.value = []
      }
    },
    { immediate: true }
  )

  watch([runtimeMode, isWindowActive], ([mode, active]) => {
    clearTimeout(refreshTimer)
    syncNativeListeners()
    if (mode !== 'standard') return
    if (!layoutReady.value) return
    if (active) syncSelection()
  })

  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(refreshTimer)
    removeNativeListeners()
  })
}
