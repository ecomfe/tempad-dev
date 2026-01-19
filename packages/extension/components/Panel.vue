<script setup lang="ts">
import { useDraggable, useEventListener, useWindowSize, watchDebounced } from '@vueuse/core'

import { useScrollbar } from '@/composables'
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

const panelWidth = ref(position?.width ?? ui.tempadPanelWidth)

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

  resizeState = {
    direction,
    startX: e.clientX,
    startWidth: panelWidth.value,
    target,
    pointerId: e.pointerId
  }
}

function onPointerMove(e: PointerEvent) {
  if (!resizeState) return

  if (e.pointerId !== resizeState.pointerId) return

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
  if (!resizeState || e.pointerId !== resizeState.pointerId) return

  resizeState.target.releasePointerCapture(resizeState.pointerId)

  if (position) {
    position.width = panelWidth.value
  }

  resizeState = null
}

function resetWidth(direction: 'left' | 'right') {
  const newWidth = ui.tempadPanelWidth
  const positionDelta = panelWidth.value - newWidth

  // Keep the edge under the double-clicked handle stationary
  if (direction === 'left' && positionDelta !== 0) {
    x.value += positionDelta
  }

  panelWidth.value = newWidth

  if (position) {
    delete position.width
  }
}

useEventListener('pointermove', onPointerMove)
useEventListener('pointerup', endResize)
useEventListener('pointercancel', endResize)

const isAtMinWidth = computed(() => panelWidth.value <= ui.tempadPanelWidth)
const isAtMaxWidth = computed(() => panelWidth.value >= ui.tempadPanelMaxWidth)

const restrictedPosition = computed(() => {
  if (!header.value) {
    return { top: x.value, left: y.value }
  }

  const panelPixelWidth = panelWidth.value
  const headerHeight = header.value.offsetHeight - 1

  const xMin = -panelPixelWidth / 2
  const xMax = windowWidth.value - panelPixelWidth / 2
  const yMin = ui.topBoundary
  const yMax = windowHeight.value - headerHeight - ui.bottomBoundary

  return {
    top: Math.max(yMin, Math.min(yMax, y.value)),
    left: Math.max(xMin, Math.min(xMax, x.value))
  }
})

const panelMaxHeight = computed(
  () => `${windowHeight.value - restrictedPosition.value.top - ui.bottomBoundary}px`
)
const panelMinHeight = computed(() => `${ui.tempadPanelMinHeight}px`)

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

function getResizeCursor(direction: 'left' | 'right'): 'e-resize' | 'w-resize' | 'ew-resize' {
  const atMin = isAtMinWidth.value
  const atMax = isAtMaxWidth.value

  if (direction === 'left') {
    if (atMax) return 'e-resize'
    if (atMin) return 'w-resize'
  } else {
    if (atMax) return 'w-resize'
    if (atMin) return 'e-resize'
  }
  return 'ew-resize'
}

const leftHandleCursor = computed(() => getResizeCursor('left'))
const rightHandleCursor = computed(() => getResizeCursor('right'))
</script>

<template>
  <article
    ref="panel"
    class="tp-panel"
    :class="{
      'tp-panel-minimized': options.minimized,
      'tp-panel-dragging': isDragging
    }"
    :style="positionStyle"
  >
    <div
      class="tp-panel-resize-handle tp-panel-resize-handle-left"
      @pointerdown="startResize($event, 'left')"
      @dblclick="resetWidth('left')"
    />
    <div
      class="tp-panel-resize-handle tp-panel-resize-handle-right"
      @pointerdown="startResize($event, 'right')"
      @dblclick="resetWidth('right')"
    />
    <div class="tp-panel-wrapper">
      <header
        ref="header"
        class="tp-row tp-row-justify tp-panel-header"
        @dblclick="toggleMinimized"
      >
        <slot name="header" />
      </header>
      <main ref="main" class="tp-panel-main">
        <slot />
      </main>
    </div>
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
  min-height: v-bind(panelMinHeight);
  background-color: var(--color-bg);
  border-radius: var(--radius-large);
  box-shadow: var(--elevation-100);
}

.tp-panel-wrapper {
  display: flex;
  flex-direction: column;
  border-radius: inherit;
  overflow: hidden;
  flex: 1 1 auto;
  min-height: 0;
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
}

.tp-panel-header-icon {
  width: auto;
  height: 32px;
}
</style>
