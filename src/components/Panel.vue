<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useDraggable, useWindowSize, watchDebounced } from '@vueuse/core'
import {
  OverlayScrollbars,
  ScrollbarsHidingPlugin,
  SizeObserverPlugin,
  ClickScrollPlugin
} from 'overlayscrollbars';
import { options } from '@/entrypoints/ui/state'
import { TOOLBAR_HEIGHT } from '@/entrypoints/ui/const'

OverlayScrollbars.plugin([ScrollbarsHidingPlugin, SizeObserverPlugin, ClickScrollPlugin])

const panel = ref<HTMLElement | null>(null)
const header = ref<HTMLElement | null>(null)
const main = ref<HTMLElement | null>(null)

const position = options.value.panelPosition
const { x, y } = useDraggable(panel, {
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

const panelMaxHeight = computed(() => `${windowHeight.value - restrictedPosition.value.top}px`)

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

let os: OverlayScrollbars

onMounted(() => {
  if (!main.value) {
    return
  }

  os = OverlayScrollbars(main.value, {
    overflow: {
      x: 'hidden'
    },
    scrollbars: {
      autoHide: 'leave',
      autoHideDelay: 0,
      clickScroll: true
    }
  })
})

onUnmounted(() => {
  os?.destroy()
})
</script>

<template>
  <article ref="panel" class="tp-panel" :style="positionStyle">
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
  max-height: v-bind(panelMaxHeight);
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
}

.tp-panel-header-icon {
  width: auto;
  height: 32px;
}
</style>

<style>
.os-scrollbar {
  --os-track-bg-hover: var(--color-scrollbartrackhover);
  --os-track-bg-active: var(--color-scrollbartrackdrag);
  --os-handle-bg: var(--color-scrollbar);
  --os-handle-bg-hover: var(--color-scrollbar);
  --os-handle-bg-active: var(--color-scrollbar);
}

.os-scrollbar-vertical:hover::before {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: -1px;
  width: 1px;
  background-color: var(--color-border);
}
</style>
