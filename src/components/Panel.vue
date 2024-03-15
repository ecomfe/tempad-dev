<script lang="ts" setup>
import { ref, computed } from 'vue'
import { useDraggable, useWindowSize, watchDebounced } from '@vueuse/core'
import { options } from '@/entrypoints/ui/state'
import { TOOLBAR_HEIGHT } from '@/entrypoints/ui/const'

const panel = ref<HTMLElement | null>(null)
const header = ref<HTMLElement | null>(null)

const position = options.value.panelPosition
const { style, x, y } = useDraggable(panel, {
  initialValue: {
    x: position ? position.left : 0,
    y: position ? position.top : 0
  },
  handle: header
})

const { width: windowWidth, height: windowHeight } = useWindowSize()

const restrictedPosition = computed(() => {
  if (!panel.value || !header.value) {
    return { top: x.value, left: y.value }
  }

  const { offsetWidth: panelWidth } = panel.value
  const { offsetHeight: headerHeight } = header.value

  const xMin = -panelWidth / 2
  const xMax = windowWidth.value - panelWidth / 2
  const yMin = TOOLBAR_HEIGHT
  const yMax = windowHeight.value - headerHeight

  return {
    top: Math.max(yMin, Math.min(yMax, y.value)),
    left: Math.max(xMin, Math.min(xMax, x.value))
  }
})

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
  <article ref="panel" class="tp-panel" :style="positionStyle">
    <header ref="header" class="tp-row tp-row-justify tp-panel-header" @dblclick="toggleMinimized">
      <slot name="header" />
    </header>
    <main class="tp-panel-main">
      <slot />
    </main>
  </article>
</template>

<style scoped>
.tp-panel {
  position: fixed;
  z-index: 8;
  display: flex;
  flex-direction: column;
  background-color: var(--color-bg);
  border-radius: 2px;
  box-shadow: var(--elevation-500-modal-window);
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

.tp-panel-main {
  flex: 1 1 auto;
  overflow-y: auto;
}

.tp-panel-header-icon {
  width: auto;
  height: 32px;
}
</style>
