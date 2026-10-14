import { useEventListener, useResizeObserver } from '@vueuse/core'
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue'

import {
  canvasClipStyle,
  canvasHoverContains,
  canvasRectsOverlap,
  observeCanvasOverlay,
  placeCanvasPopover,
  projectCanvasAnchor,
  selectionActionBounds,
  type CanvasOverlayFrame
} from '@/mcp/canvas-overlay'

type Marker = {
  node: SceneNode
  nodeId: string
  number: number | null
  x: number
  y: number
  revealed: boolean
  occluded: boolean
}
type FeedbackCanvasState = {
  enabled: boolean
  fileKey?: string
  canDraft: boolean
  canAdd: boolean
  drafts: readonly { node: SceneNode | null; item: { nodeId: string } }[]
  editor: { node: SceneNode; nodeId: string } | null
  batchOpen: boolean
}
type FeedbackCanvasElements = {
  editor: Readonly<Ref<HTMLElement | null>>
  editorInput: Readonly<Ref<HTMLTextAreaElement | null>>
  batch: Readonly<Ref<HTMLElement | null>>
  commentInput: Readonly<Ref<HTMLTextAreaElement | null>>
  batchTrigger: () => Element | null | undefined
}

function visibleNodePage(node: SceneNode): string | null {
  if (node.removed) return null
  let page: BaseNode | null = node
  while (page && page.type !== 'PAGE') {
    if ('visible' in page && !page.visible) return null
    page = page.parent
  }
  return page?.id ?? null
}

// Canvas interaction owns no draft storage or delivery state.
export function useFeedbackCanvas(
  readState: () => FeedbackCanvasState,
  elements: FeedbackCanvasElements,
  onPageChange: () => void
) {
  let suppressedNode: string | null = null
  let selectedNodeId: string | null = null
  const hoveredMarker = shallowRef<string | null>(null)
  let hideAddAt: number | undefined
  let pointer: { x: number; y: number } | null = null
  useEventListener(
    window,
    'pointermove',
    (event) => {
      pointer = { x: event.clientX, y: event.clientY }
    },
    { passive: true, capture: true }
  )
  useEventListener(window, 'pointerout', (event) => {
    if (!event.relatedTarget) pointer = null
  })
  useEventListener(window, 'blur', () => {
    pointer = null
    hoveredMarker.value = null
  })
  const editorMultiline = shallowRef(false)
  const commentMultiline = shallowRef(false)
  const editorHeight = shallowRef(220)
  const batchHeight = shallowRef(320)
  useResizeObserver(elements.editor, () => {
    editorHeight.value = elements.editor.value?.offsetHeight ?? 220
  })
  useResizeObserver(elements.batch, () => {
    batchHeight.value = elements.batch.value?.offsetHeight ?? 320
  })

  const projection = shallowRef<{
    clip: ReturnType<typeof canvasClipStyle>
    markers: Marker[]
    editor: { left: string; top: string; width: string; maxHeight: string } | null
    batch: { left: string; top: string; width: string; maxHeight: string } | null
  } | null>(null)
  let previousProjection = ''
  let previousPage = ''
  function updateProjection(frame: CanvasOverlayFrame | null): void {
    const state = readState()
    if (!state.enabled || !frame || (frame.fileKey && frame.fileKey !== state.fileKey)) {
      projection.value = null
      previousProjection = ''
      hideAddAt = undefined
      hoveredMarker.value = null
      return
    }
    const pageKey = `${frame.fileKey}/${frame.pageId}`
    if (previousPage !== pageKey) {
      previousPage = pageKey
      hoveredMarker.value = null
      hideAddAt = undefined
      onPageChange()
    }
    editorMultiline.value = (elements.editorInput.value?.offsetHeight ?? 28) > 28
    commentMultiline.value = (elements.commentInput.value?.offsetHeight ?? 28) > 28
    const { canvas } = frame
    const selected = frame.selectedNode
    const nativeControls = selectionActionBounds(frame)
    if (selected?.id !== selectedNodeId) {
      suppressedNode = null
      hoveredMarker.value = null
      hideAddAt = undefined
    }
    selectedNodeId = selected?.id ?? null
    const markers: Marker[] = []
    function position(node: SceneNode, allowOffscreen = false): { x: number; y: number } | null {
      try {
        if (visibleNodePage(node) !== frame!.pageId || !node.absoluteBoundingBox) return null
        const rect = projectCanvasAnchor(node.absoluteBoundingBox, frame!.bounds, frame!.zoom)
        if (
          !rect ||
          (!allowOffscreen &&
            (rect.x + rect.width < 0 ||
              rect.y + rect.height < 0 ||
              rect.x > canvas.width ||
              rect.y > canvas.height))
        )
          return null
        const point = { x: rect.x + rect.width + 9, y: rect.y + 28 }
        if (allowOffscreen) return point
        const size = 16
        return {
          // Align below the native 16px Agent entry, with an 8px gap.
          x: Math.max(8, Math.min(point.x, canvas.width - size - 8)),
          y: Math.max(8, Math.min(point.y, canvas.height - size - 8))
        }
      } catch {
        return null
      }
    }
    function add(node: SceneNode, number: number | null): void {
      const point = position(node)
      if (!point) return
      const size = 16
      // Nested elements can share a corner. Keep their numbered targets independently clickable.
      while (
        (nativeControls &&
          canvasRectsOverlap({ ...point, width: size, height: size }, nativeControls)) ||
        markers.some(
          (marker) => Math.abs(marker.x - point.x) < 30 && Math.abs(marker.y - point.y) < 30
        )
      ) {
        if (point.y + size + 40 <= canvas.height) point.y += 32
        else if (point.x >= 40) {
          point.x -= 32
          point.y = Math.max(8, point.y - 32)
        } else return
      }
      const rect =
        number === null && node.absoluteBoundingBox
          ? projectCanvasAnchor(node.absoluteBoundingBox, frame!.bounds, frame!.zoom)
          : null
      const x = pointer ? pointer.x - canvas.left : null
      const y = pointer ? pointer.y - canvas.top : null
      const wasRevealed = projection.value?.markers.some(
        (marker) => marker.nodeId === node.id && marker.number === null && marker.revealed
      )
      // The selected element is a canvas shape; its entry test must use projection.
      // Retain travel passively so native controls and resize handles keep their hit targets.
      let revealed =
        number !== null ||
        state.editor?.nodeId === node.id ||
        hoveredMarker.value === node.id ||
        !!(
          rect &&
          x !== null &&
          y !== null &&
          x >= 0 &&
          x <= canvas.width &&
          y >= 0 &&
          y <= canvas.height &&
          canvasHoverContains({ x, y }, [
            rect,
            ...(wasRevealed
              ? [{ x: point.x - 4, y: point.y - 4, width: size + 8, height: size + 8 }]
              : [])
          ])
        )
      if (number === null) {
        if (revealed) hideAddAt = undefined
        else if (wasRevealed) {
          const now = performance.now()
          hideAddAt ??= now + 100
          revealed = now < hideAddAt
        }
      }
      const occluded = (frame!.tooltips ?? []).some((tooltip) =>
        canvasRectsOverlap(
          { x: canvas.left + point.x, y: canvas.top + point.y, width: size, height: size },
          tooltip
        )
      )
      markers.push({ node, nodeId: node.id, number, ...point, revealed, occluded })
    }
    state.drafts.forEach((draft, index) => {
      if (draft.node) add(draft.node, index + 1)
    })
    if (
      state.canAdd &&
      selected &&
      selected.id !== suppressedNode &&
      !state.drafts.some((draft) => draft.item.nodeId === selected.id)
    )
      add(selected, null)
    const target =
      state.editor &&
      (markers.find((marker) => marker.nodeId === state.editor!.nodeId) ??
        position(state.editor.node, true))
    const width = Math.max(0, Math.min(300, canvas.width - 16))
    const popup =
      target &&
      placeCanvasPopover(
        { ...target, width: 16, height: 16 },
        { width, height: Math.min(editorHeight.value, Math.max(0, canvas.height - 16)) },
        canvas
      )
    const editorPosition = popup
      ? {
          left: `${popup.x}px`,
          top: `${popup.y}px`,
          width: `${width}px`,
          maxHeight: `${canvas.height - 16}px`
        }
      : null
    const trigger = state.batchOpen ? elements.batchTrigger() : null
    const anchor = (trigger?.closest('.tp-design-feedback') ?? trigger)?.getBoundingClientRect()
    const below = (anchor?.bottom ?? 0) - canvas.top + 8
    const above = (anchor?.top ?? 0) - canvas.top - batchHeight.value - 8
    const batchPosition = anchor?.width
      ? {
          left: `${Math.max(8, Math.min(anchor.right - canvas.left - width, canvas.width - width - 8))}px`,
          top: `${Math.max(8, Math.min(below + batchHeight.value <= canvas.height - 8 ? below : above, canvas.height - batchHeight.value - 8))}px`,
          width: `${width}px`,
          maxHeight: `${canvas.height - 16}px`
        }
      : null
    const next = {
      clip: canvasClipStyle(canvas),
      markers,
      editor: editorPosition,
      batch: batchPosition
    }
    const serialized = JSON.stringify({
      ...next,
      markers: markers.map(({ node: _node, ...marker }) => marker)
    })
    if (serialized !== previousProjection) {
      projection.value = next
      previousProjection = serialized
    }
  }

  let stopObserving: (() => void) | undefined
  watch(
    () => {
      const state = readState()
      return (
        state.enabled &&
        (state.canDraft || state.drafts.length > 0 || !!state.editor || state.batchOpen)
      )
    },
    (observe) => {
      stopObserving?.()
      stopObserving = observe ? observeCanvasOverlay(updateProjection) : undefined
      previousProjection = ''
      if (!observe) projection.value = null
    },
    { immediate: true }
  )

  function reset(): void {
    previousProjection = ''
    previousPage = ''
    projection.value = null
    suppressedNode = null
    hoveredMarker.value = null
    hideAddAt = undefined
  }

  function suppressSelection(): void {
    suppressedNode = selectedNodeId
  }

  function syncDraftMarkers(): void {
    if (!projection.value) return
    const drafts = readState().drafts
    // Remove sent markers before releasing their fade, even between idle canvas measurements.
    projection.value = {
      ...projection.value,
      markers: projection.value.markers.flatMap((marker) => {
        if (marker.number === null) return marker
        const index = drafts.findIndex((draft) => draft.item.nodeId === marker.nodeId)
        return index < 0 ? [] : { ...marker, number: index + 1 }
      })
    }
    previousProjection = ''
  }

  onScopeDispose(() => stopObserving?.())

  return {
    projection,
    hoveredMarker,
    editorMultiline,
    commentMultiline,
    reset,
    suppressSelection,
    syncDraftMarkers
  }
}
