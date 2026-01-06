<script setup lang="ts">
import { useIdle, useIntervalFn, useTimeoutFn } from '@vueuse/core'

import Badge from '@/components/Badge.vue'
import IconButton from '@/components/IconButton.vue'
import Minus from '@/components/icons/Minus.vue'
import Plus from '@/components/icons/Plus.vue'
import Preferences from '@/components/icons/Preferences.vue'
import Panel from '@/components/Panel.vue'
import CodeSection from '@/components/sections/CodeSection.vue'
import ErrorSection from '@/components/sections/ErrorSection.vue'
import MetaSection from '@/components/sections/MetaSection.vue'
import PrefSection from '@/components/sections/PrefSection.vue'
import {
  syncSelection,
  useFigmaAvailability,
  useKeyLock,
  useMcp,
  useSelection
} from '@/composables'
import { layoutReady, options, runtimeMode, selection } from '@/ui/state'
import { getCanvas } from '@/utils'

useSelection()
useKeyLock()

const HINT_CHECK_INTERVAL = 500

useFigmaAvailability()

const HINT_IDLE_MS = 10000

function toggleMinimized() {
  options.value.minimized = !options.value.minimized
}

const { status, selfActive, count, activate } = useMcp()

const isMcpConnected = computed(() => status.value === 'connected')

const mcpBadgeTone = computed(() => {
  if (!isMcpConnected.value) return 'neutral'
  if (!selfActive.value) return 'neutral'
  return 'success'
})

const mcpBadgeVariant = computed(() => {
  if (!isMcpConnected.value) return 'dashed'
  if (!selfActive.value) return 'dashed'
  return 'solid'
})

const mcpBadgeTooltip = computed(() => {
  if (!isMcpConnected.value) {
    return 'Unavailable'
  }

  const fileCount = count.value || 0
  const fileLabel = fileCount > 1 ? ` • ${fileCount} files` : ''

  if (selfActive.value) {
    return `Active${fileLabel}`
  }

  return `Inactive${fileLabel}\nClick to activate`
})

const mcpBadgeStatusClass = computed(() => `tp-mcp-badge-${status.value}`)
const mcpBadgeActiveClass = computed(() =>
  isMcpConnected.value ? (selfActive.value ? 'tp-mcp-badge-active' : 'tp-mcp-badge-inactive') : null
)

const lowVisibility = ref(false)
const initialLock = ref(true)
const { idle } = useIdle(HINT_IDLE_MS, {
  initialState: true
})

function getOverlapWidth(a: DOMRect, b: DOMRect) {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
}

function updateHintOverlap() {
  if (!layoutReady.value) {
    lowVisibility.value = false
    return
  }

  const canvas = getCanvas()
  const panel = document.querySelector('.tp-panel.tp-main') as HTMLElement | null
  if (!canvas || !panel) {
    lowVisibility.value = false
    return
  }

  const panelRect = panel.getBoundingClientRect()
  const canvasRect = canvas.getBoundingClientRect()
  const overlapWidth = getOverlapWidth(panelRect, canvasRect)

  if (panelRect.width <= 0) {
    lowVisibility.value = false
    return
  }

  lowVisibility.value = overlapWidth < panelRect.width / 3
}

useIntervalFn(updateHintOverlap, HINT_CHECK_INTERVAL, { immediate: true })

useTimeoutFn(() => {
  initialLock.value = false
}, 3000)

const showHint = computed(() => (idle.value || initialLock.value) && lowVisibility.value)

watch(layoutReady, (ready) => {
  if (ready) {
    syncSelection()
    return
  }
  if (selection.value.length) {
    selection.value = []
  }
})

function activateMcp() {
  if (isMcpConnected.value) {
    activate()
  }
}
</script>

<template>
  <Panel
    v-show="layoutReady"
    class="tp-main"
    :class="{ 'tp-main-minimized': options.minimized, 'tp-main-hint': showHint }"
  >
    <template #header>
      <div class="tp-row tp-gap-l">
        <span>TemPad Dev</span>
        <Badge
          v-if="options.mcpOn && runtimeMode === 'standard'"
          :class="['tp-mcp-badge', mcpBadgeStatusClass, mcpBadgeActiveClass]"
          :tone="mcpBadgeTone"
          :variant="mcpBadgeVariant"
          :title="mcpBadgeTooltip"
          @click="activateMcp"
          @dblclick.stop
        >
          <span class="tp-mcp-dot" />
          MCP
        </Badge>
      </div>
      <div class="tp-row tp-gap">
        <IconButton
          v-if="runtimeMode !== 'unavailable' && !options.minimized"
          title="Preferences"
          toggle
          v-model:selected="options.prefOpen"
          @dblclick.stop
        >
          <Preferences class="tp-panel-header-icon" />
        </IconButton>
        <IconButton @click="toggleMinimized">
          <Plus v-if="options.minimized" />
          <Minus v-else />
        </IconButton>
      </div>
    </template>
    <ErrorSection v-if="runtimeMode === 'unavailable'" />
    <template v-else>
      <PrefSection :collapsed="!options.prefOpen" />
      <MetaSection />
      <CodeSection />
    </template>
  </Panel>
</template>

<style scoped>
.tp-main {
  transition:
    height 0.2s cubic-bezier(0.87, 0, 0.13, 1),
    box-shadow 0.2s cubic-bezier(0.87, 0, 0.13, 1);
}

.tp-main-minimized {
  height: 41px;
  border-bottom-width: 0;
}

.tp-main-hint {
  animation: tp-main-hint-pulse 10s cubic-bezier(0.87, 0, 0.13, 1) infinite;
}

.tp-main.tp-panel-dragging,
.tp-main.tp-panel-resizing {
  transition: none;
}

.tp-mcp-badge {
  gap: 4px;
}

.tp-mcp-badge-inactive .tp-mcp-dot {
  animation: tp-mcp-dot-pulse 1.2s ease-in-out infinite;
  background-color: var(--color-icon-success, #1bc47d);
}

.tp-mcp-badge-connected:hover {
  border-style: solid;
}

.tp-mcp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-icon-disabled, #9ba1a6);
  box-sizing: border-box;
}

.tp-mcp-badge-active .tp-mcp-dot {
  background-color: var(--color-icon-success, #1bc47d);
}

@keyframes tp-mcp-dot-pulse {
  0%,
  100% {
    opacity: 0.2;
  }
  50% {
    opacity: 1;
  }
}

@keyframes tp-main-hint-pulse {
  0%,
  20%,
  40%,
  60%,
  80%,
  100% {
    box-shadow: var(--elevation-100);
  }
  10% {
    box-shadow:
      var(--elevation-100),
      0 0 0 2px #f24e1e;
  }
  30% {
    box-shadow:
      var(--elevation-100),
      0 0 0 2px #ff7262;
  }
  50% {
    box-shadow:
      var(--elevation-100),
      0 0 0 2px #a259ff;
  }
  70% {
    box-shadow:
      var(--elevation-100),
      0 0 0 2px #1abcfe;
  }
  90% {
    box-shadow:
      var(--elevation-100),
      0 0 0 2px #0acf83;
  }
}

@media (prefers-reduced-motion: reduce) {
  .tp-main-hint {
    animation: none;
  }
}
</style>
