<script setup lang="ts">
import { useDraggable, useWindowSize, watchDebounced } from '@vueuse/core'

import { useResizable } from '@/composables'
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

const {
  width: panelWidth,
  isResizing,
  onResizeRightStart,
  onResizeLeftStart
} = useResizable({
  min: 300,
  max: 800,
  defaultWidth: 400,
  initialWidth: position?.width,
  positionX: x,
  onResizeEnd: (width) => {
    if (position) {
      position.width = width
    }
  }
})

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
      @pointerdown="onResizeLeftStart"
    />
    <div
      class="tp-panel-resize-handle tp-panel-resize-handle-right"
      @pointerdown="onResizeRightStart"
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
  cursor: ew-resize;
}

.tp-panel-resizing * {
  cursor: ew-resize !important;
}

.tp-panel-resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 8px;
  cursor: ew-resize;
  z-index: 100;
  transition: background-color 0.2s ease;
  touch-action: none;
  user-select: none;
}

.tp-panel-resize-handle-left {
  left: 0;
}

.tp-panel-resize-handle-right {
  right: 0;
}

.tp-panel-resize-handle::before {
  content: '';
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 40px;
  background-color: transparent;
  transition: background-color 0.2s ease;
}

.tp-panel-resize-handle-left::before {
  left: 3px;
}

.tp-panel-resize-handle-right::before {
  right: 3px;
}

.tp-panel-resize-handle:hover {
  background-color: var(--figma-color-bg-brand-hover, rgba(24, 160, 251, 0.08));
}

.tp-panel-resize-handle:hover::before {
  background-color: var(--figma-color-bg-brand, rgba(24, 160, 251, 0.8));
}

.tp-panel-resize-handle:active {
  background-color: var(--figma-color-bg-brand-pressed, rgba(24, 160, 251, 0.15));
}

.tp-panel-resize-handle:active::before {
  background-color: var(--figma-color-bg-brand, rgb(24, 160, 251));
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

[data-fpl-version='ui3'] .tp-panel {
  box-shadow: var(--elevation-100);
  border-radius: var(--radius-large);
}
</style>
