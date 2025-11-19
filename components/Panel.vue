<script setup lang="ts">
import { useDraggable, useEventListener, useWindowSize, watchDebounced } from '@vueuse/core'

import { useScrollbar } from '@/composables/scrollbar'
import { ui } from '@/ui/figma'
import { options } from '@/ui/state'

const panel = useTemplateRef('panel')
const header = useTemplateRef('header')
const main = useTemplateRef('main')

useScrollbar(main, {
  overflow: {
    x: 'hidden'
  },
  scrollbars: {
    autoHide: 'leave',
    autoHideDelay: 0,
    clickScroll: true
  }
})

const position = options.value.panelPosition
const { x, y, isDragging } = useDraggable(panel, {
  initialValue: {
    x: position ? position.left : 0,
    y: position ? position.top : 0
  },
  handle: header
})

const { width: windowWidth, height: windowHeight } = useWindowSize()

const panelWidth = ref(position ? position.width : ui.tempadPanelWidth)
const isResizing = ref(false)

let resizeState: {
  direction: 'left' | 'right'
  startX: number
  startWidth: number
  target: HTMLElement
  pointerId: number
} | null = null

function clampWidth(value: number): number {
  return Math.max(ui.tempadPanelWidth, Math.min(ui.tempadPanelMaxWidth, value))
}

function startResize(e: PointerEvent, direction: 'left' | 'right') {
  e.preventDefault()
  e.stopPropagation()

  const target = e.currentTarget as HTMLElement
  if (!target) return

  target.setPointerCapture(e.pointerId)
  isResizing.value = true

  resizeState = {
    direction,
    startX: e.clientX,
    startWidth: panelWidth.value,
    target,
    pointerId: e.pointerId
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isResizing.value || !resizeState) return

  if (e.buttons === 0) {
    endResize(e)
    return
  }

  const deltaX = e.clientX - resizeState.startX
  const newWidth =
    resizeState.direction === 'right'
      ? clampWidth(resizeState.startWidth + deltaX)
      : clampWidth(resizeState.startWidth - deltaX)

  if (resizeState.direction === 'left') {
    const positionDelta = panelWidth.value - newWidth
    x.value += positionDelta
  }

  panelWidth.value = newWidth
}

function endResize(e: PointerEvent) {
  if (!isResizing.value || !resizeState) return

  isResizing.value = false
  resizeState.target.releasePointerCapture(resizeState.pointerId)

  if (position) {
    position.width = panelWidth.value
  }

  resizeState = null
}

function resetWidth() {
  panelWidth.value = ui.tempadPanelWidth
  if (position) {
    position.width = ui.tempadPanelWidth
  }
}

useEventListener('pointermove', onPointerMove)
useEventListener('pointerup', endResize)
useEventListener('pointercancel', endResize)

const isAtMinWidth = computed(() => panelWidth.value <= ui.tempadPanelWidth)
const isAtMaxWidth = computed(() => panelWidth.value >= ui.tempadPanelMaxWidth)

const restrictedPosition = computed(() => {
  if (!panel.value || !header.value) {
    return { top: x.value, left: y.value }
  }

  const { offsetWidth: panelWidth } = panel.value
  const { offsetHeight: headerHeight } = header.value

  const xMin = -panelWidth / 2
  const xMax = windowWidth.value - panelWidth / 2
  const yMin = ui.topBoundary
  const yMax = windowHeight.value - headerHeight

  return {
    top: Math.max(yMin, Math.min(yMax, y.value)),
    left: Math.max(xMin, Math.min(xMax, x.value))
  }
})

const panelMaxHeight = computed(
  () => `${windowHeight.value - restrictedPosition.value.top - ui.bottomBoundary}px`
)

const panelWidthPx = computed(() => `${panelWidth.value}px`)

const positionStyle = computed(() => {
  const p = restrictedPosition.value
  return `top: ${p.top}px; left: ${p.left}px`
})

if (position) {
  watchDebounced(
    restrictedPosition,
    () => {
      position.top = restrictedPosition.value.top
      position.left = restrictedPosition.value.left
    },
    { debounce: 300 }
  )
}

function toggleMinimized() {
  options.value.minimized = !options.value.minimized
}

const leftHandleCursor = computed(() => {
  if (isAtMaxWidth.value) return 'e-resize'
  if (isAtMinWidth.value) return 'w-resize'
  return 'ew-resize'
})

const rightHandleCursor = computed(() => {
  if (isAtMaxWidth.value) return 'w-resize'
  if (isAtMinWidth.value) return 'e-resize'
  return 'ew-resize'
})

const resizingCursor = 'ew-resize'
</script>

<template>
  <article
    ref="panel"
    class="tp-panel"
    :class="{
      'tp-panel-minimized': options.minimized,
      'tp-panel-resizing': isResizing,
      'tp-panel-dragging': isDragging
    }"
    :style="positionStyle"
  >
    <div
      class="tp-panel-resize-handle tp-panel-resize-handle-left"
      @pointerdown="startResize($event, 'left')"
      @dblclick="resetWidth"
    />
    <div
      class="tp-panel-resize-handle tp-panel-resize-handle-right"
      @pointerdown="startResize($event, 'right')"
      @dblclick="resetWidth"
    />
    <header ref="header" class="tp-row tp-row-justify tp-panel-header" @dblclick="toggleMinimized">
      <slot name="header" />
    </header>
    <main ref="main" class="tp-panel-main">
      <slot />
    </main>
  </article>
</template>

<style scoped>
.tp-panel {
  position: fixed;
  z-index: 6;
  display: flex;
  flex-direction: column;
  width: v-bind(panelWidthPx);
  max-height: v-bind(panelMaxHeight);
  background-color: var(--color-bg);
  border-radius: 2px;
  box-shadow: var(--elevation-500-modal-window);
}

.tp-panel-resizing {
  user-select: none;
  cursor: v-bind(resizingCursor);
}

.tp-panel-resizing * {
  user-select: none;
  cursor: v-bind(resizingCursor) !important;
}

.tp-panel-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 10;
  transition: background-color 0.2s ease;
  touch-action: none;
  user-select: none;
}

.tp-panel-resize-handle-left {
  left: -8px;
  cursor: v-bind(leftHandleCursor);
}

.tp-panel-resize-handle-right {
  right: -8px;
  cursor: v-bind(rightHandleCursor);
}

.tp-panel-header {
  flex: 0 0 auto;
  height: 41px;
  border-bottom: 1px solid var(--color-border);
  padding: 4px 8px 4px 16px;
  font-weight: 600;
  user-select: none;
  cursor: default;
  white-space: nowrap;
}

.tp-panel-minimized .tp-panel-header {
  border-bottom-color: transparent;
}

.tp-panel-main {
  flex: 1 1 auto;
  border-bottom-left-radius: 0.8125rem;
  border-bottom-right-radius: 0.8125rem;
}

.tp-panel-header-icon {
  width: auto;
  height: 32px;
}

[data-fpl-version='ui3'] .tp-panel {
  box-shadow: var(--elevation-100);
  border-radius: var(--radius-large);
}
</style>
