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

const mcp = useMcp()

const isMcpConnected = computed(() => mcp.status.value === 'connected')
const isMcpDashed = computed(
  () => isMcpConnected.value && mcp.count.value > 1 && !mcp.selfActive.value
)

const mcpBadgeTooltip = computed(() => {
  if (isMcpConnected.value) {
    const count = mcp.count.value || 0
    const port = mcp.port.value ?? 'unknown'
    return `Connected with ${count} windows • Click to activate this window • localhost:${port}`
  }
  return 'MCP not connected'
})

function activateMcp() {
  if (isMcpConnected.value) {
    mcp.activate()
  }
}
</script>

<template>
  <Panel class="tp-main" :class="{ 'tp-main-minimized': options.minimized }">
    <template #header>
      <div class="tp-row tp-gap-l">
        <span>TemPad Dev</span>
        <Badge
          v-if="options.mcpOn"
          class="tp-mcp-badge"
          :class="{
            'tp-mcp-badge-connected': isMcpConnected,
            'tp-mcp-badge-dashed': isMcpDashed
          }"
          :title="mcpBadgeTooltip"
          @click="activateMcp"
        >
          <span class="tp-mcp-dot" :class="{ 'tp-mcp-dot-on': isMcpConnected }" />
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  border-style: solid;
}

.tp-mcp-badge-dashed {
  border-style: dashed;
}

.tp-mcp-badge:not(.tp-mcp-badge-connected) {
  opacity: 0.75;
}

.tp-mcp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-icon-disabled, #9ba1a6);
}

.tp-mcp-dot-on {
  background-color: var(--color-icon-success, #1bc47d);
}
</style>
