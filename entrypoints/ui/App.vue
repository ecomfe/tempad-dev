<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Minus from '@/components/icons/Minus.vue'
import Plus from '@/components/icons/Plus.vue'
import Preferences from '@/components/icons/Preferences.vue'
import Panel from '@/components/Panel.vue'
import Badge from '@/components/Badge.vue'
import CodeSection from '@/components/sections/CodeSection.vue'
import ErrorSection from '@/components/sections/ErrorSection.vue'
import MetaSection from '@/components/sections/MetaSection.vue'
import PrefSection from '@/components/sections/PrefSection.vue'
import { useKeyLock, useSelection } from '@/composables'
import { ui } from '@/ui/figma'
import { useMcp } from '@/composables/mcp'
import { options, runtimeMode } from '@/ui/state'

useSelection()
useKeyLock()

function toggleMinimized() {
  options.value.minimized = !options.value.minimized
}

const panelWidth = `${ui.tempadPanelWidth}px`

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
    return 'Unavailable • Start MCP server to enable files'
  }

  const fileCount = count.value || 0
  const fileLabel = fileCount > 1 ? ` • ${fileCount} files` : ''

  if (selfActive.value) {
    return `Active${fileLabel}`
  }

  return `Inactive${fileLabel} • Click to activate`
})

const mcpBadgeStatusClass = computed(() => `tp-mcp-badge-${status.value}`)

function activateMcp() {
  if (isMcpConnected.value) {
    activate()
  }
}
</script>

<template>
  <Panel class="tp-main" :class="{ 'tp-main-minimized': options.minimized }">
    <template #header>
      <div class="tp-row tp-gap-l">
        <span>TemPad Dev</span>
        <Badge
          v-if="options.mcpOn && runtimeMode === 'standard'"
          :class="['tp-mcp-badge', mcpBadgeStatusClass]"
          :tone="mcpBadgeTone"
          :variant="mcpBadgeVariant"
          :title="mcpBadgeTooltip"
          @click="activateMcp"
          @dblclick.stop
        >
          <span
            class="tp-mcp-dot"
            :class="{
              'tp-mcp-dot-connected-inactive': isMcpConnected && !selfActive,
              'tp-mcp-dot-connected-active': isMcpConnected && selfActive
            }"
          />
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
  width: v-bind(panelWidth);
  transition: width, height;
  transition-duration: 0.2s;
  transition-timing-function: cubic-bezier(0.87, 0, 0.13, 1);
  overflow: hidden;
}

.tp-main-minimized {
  height: 41px;
  border-bottom-width: 0;
}

.tp-mcp-badge {
  gap: 4px;
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

.tp-mcp-dot-connected-inactive {
  background-color: transparent;
  border: 1px solid var(--color-icon-success, #1bc47d);
}

.tp-mcp-dot-connected-active {
  background-color: var(--color-icon-success, #1bc47d);
}
</style>
