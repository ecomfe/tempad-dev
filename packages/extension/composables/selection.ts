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

export function syncSelection(refreshContent = true) {
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
  const changed = selectionFileKey !== fileKey || !isSameSelection(next, selection.value)
  if (changed) {
    selection.value = next
  }
  selectionFileKey = fileKey
  if (changed || refreshContent) selectionRevision.value++
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
  let contentChanged = false
  let nativeSelection = false
  let nativeChanges = false
  let observedApi: PluginAPI | undefined
  let observedPage: PageNode | undefined
  const nativeListeners: Array<() => void> = []
  const pageListeners = new Map<PageNode, () => void>()
  const relevantNodes = new Set<string>()
  const relevantStyles = new Set<string>()
  const subtreeRoots = new Set<string>()

  function trackSelection() {
    relevantNodes.clear()
    relevantStyles.clear()
    subtreeRoots.clear()
    const pages = new Set(observedPage ? [observedPage] : [])
    // Code generation has no output for multiple selections. Avoid traversing
    // a whole page just to keep a hidden panel's dependencies up to date.
    if (!observedApi || selection.value.length !== 1) {
      syncPageListeners(pages)
      return
    }
    const pending: BaseNode[] = [...selection.value]
    const visited = new Set<string>()
    const ancestors = new Set<string>()

    function addDefinition(node: BaseNode) {
      if (node.type !== 'INSTANCE') return
      const component = node.mainComponent
      if (!component) return
      subtreeRoots.add(component.id)
      pending.push(component)
    }

    function trackAncestors(node: BaseNode | null) {
      while (node && !ancestors.has(node.id)) {
        ancestors.add(node.id)
        relevantNodes.add(node.id)
        if (node.type === 'PAGE') pages.add(node)
        // A selected sublayer inherits content from its containing instance.
        addDefinition(node)
        node = node.parent
      }
    }

    const selected = selection.value[0]!
    subtreeRoots.add(selected.id)
    try {
      trackAncestors(selected.parent)
    } catch {
      // Removed selections are cleared by the next selection synchronization.
    }
    while (pending.length) {
      const node = pending.pop()!
      if (visited.has(node.id)) continue
      visited.add(node.id)
      relevantNodes.add(node.id)
      try {
        if ('children' in node) pending.push(...node.children)
        for (const field of [
          'fillStyleId',
          'strokeStyleId',
          'effectStyleId',
          'gridStyleId',
          'textStyleId'
        ] as const) {
          const styleId: unknown = Reflect.get(node, field)
          if (typeof styleId === 'string') relevantStyles.add(styleId)
        }
        if (node.type === 'TEXT') {
          const fields = (['textStyleId', 'fillStyleId'] as const).filter(
            (field) => typeof node[field] === 'symbol'
          )
          if (fields.length) {
            for (const segment of node.getStyledTextSegments(fields)) {
              for (const field of fields) relevantStyles.add(segment[field])
            }
          }
        }
        addDefinition(node)
        // Component-set properties and accessible definition pages are also
        // dependencies; inherited instance edits need not emit their own event.
        if (node.type === 'COMPONENT') trackAncestors(node.parent)
      } catch {
        // A native node can disappear while its change notification is pending.
      }
    }
    syncPageListeners(pages)
  }

  function syncPageListeners(pages: Set<PageNode>) {
    for (const [page, remove] of pageListeners) {
      if (pages.has(page)) continue
      removeListener(remove)
      pageListeners.delete(page)
    }
    for (const page of pages) {
      if (
        pageListeners.has(page) ||
        typeof page.on !== 'function' ||
        typeof page.off !== 'function'
      )
        continue
      try {
        page.on('nodechange', handleNodeChange)
        pageListeners.set(page, () => page.off('nodechange', handleNodeChange))
      } catch {
        // Unavailable definition pages remain covered by local edits/focus.
      }
    }
    nativeChanges = !!observedPage && pageListeners.has(observedPage)
  }

  function changedNodeAffectsSelection(change: NodeChange): boolean {
    if (relevantNodes.has(change.id)) return true
    if (change.node.removed) return false
    try {
      // New or reparented descendants were not present in the last snapshot.
      let parent = change.node.parent
      while (parent) {
        if (subtreeRoots.has(parent.id)) return true
        parent = parent.parent
      }
    } catch {
      // The retained identities above still recognize deleted selected content.
    }
    return false
  }

  function handleNodeChange(event?: NodeChangeEvent) {
    if (!event || event.nodeChanges.some(changedNodeAffectsSelection)) scheduleRefresh(true)
  }

  function handleStyleChange(event?: StyleChangeEvent) {
    if (!event || event.styleChanges.some(({ id }) => relevantStyles.has(id))) scheduleRefresh(true)
  }

  function handleSelectionChange() {
    scheduleRefresh()
  }

  function syncTargets() {
    canvas.value = getCanvas()
    objectsPanel.value = getLeftPanel()
  }

  function removeListener(remove: () => void) {
    try {
      remove()
    } catch {
      // A previous document's native API may already be unavailable.
    }
  }

  function removeNativeListeners() {
    for (const remove of nativeListeners.splice(0)) removeListener(remove)
    for (const remove of pageListeners.values()) removeListener(remove)
    pageListeners.clear()
    observedApi = undefined
    observedPage = undefined
    nativeSelection = false
    nativeChanges = false
  }

  function subscribe(add: () => void, remove: () => void) {
    try {
      add()
      nativeListeners.push(remove)
      return true
    } catch {
      // Runtime builds without native event support use the DOM/focus fallback.
      return false
    }
  }

  function syncNativeListeners() {
    const api = layoutReady.value && runtimeMode.value === 'standard' ? window.figma : undefined
    const page = readPageSelection(api)?.page
    if (api === observedApi && page === observedPage) return false
    removeNativeListeners()
    observedApi = api
    observedPage = page
    if (api && typeof api.on === 'function' && typeof api.off === 'function') {
      nativeSelection = subscribe(
        () => api.on('selectionchange', handleSelectionChange),
        () => api.off('selectionchange', handleSelectionChange)
      )
      subscribe(
        () => api.on('currentpagechange', handleSelectionChange),
        () => api.off('currentpagechange', handleSelectionChange)
      )
      subscribe(
        () => api.on('stylechange', handleStyleChange),
        () => api.off('stylechange', handleStyleChange)
      )
    }
    syncPageListeners(new Set(page ? [page] : []))
    return true
  }

  function scheduleRefresh(refreshContent = false) {
    clearTimeout(refreshTimer)
    if (disposed || !layoutReady.value || runtimeMode.value !== 'standard' || !isWindowActive.value)
      return
    contentChanged ||= refreshContent
    // Read after Figma's event handlers and coalesce drag, typing and native batches.
    refreshTimer = setTimeout(() => {
      const changedPage = syncNativeListeners()
      syncSelection(contentChanged || changedPage)
      contentChanged = false
    }, 100)
  }

  function handleEdit(event: Event) {
    const target = event.target as Element | null
    if (target?.closest?.('tempad')) return
    if ('key' in event && /^(Alt|Control|Meta|Shift| )$/.test(String(event.key))) return
    const changedPage = syncNativeListeners()
    // Variable edits do not have a dedicated native event. Keep actual editor
    // input as a fallback without regenerating on ordinary canvas clicks.
    const edited =
      event.type === 'input' ||
      event.type === 'change' ||
      (event.type === 'keyup' && !!target?.closest?.('input, textarea, [contenteditable="true"]'))
    if (edited || changedPage || !nativeSelection || !nativeChanges)
      scheduleRefresh(edited || !nativeChanges)
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
      contentChanged = false
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
    contentChanged = false
    syncNativeListeners()
    if (mode !== 'standard') return
    if (!layoutReady.value) return
    if (active) syncSelection()
  })

  watch([selection, selectionRevision], trackSelection, { immediate: true })

  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(refreshTimer)
    removeNativeListeners()
  })
}
