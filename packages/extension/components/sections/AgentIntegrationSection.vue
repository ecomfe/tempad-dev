<script setup lang="ts">
import { ref } from 'vue'

import AgentSetupDialog from '@/components/AgentSetupDialog.vue'
import Button from '@/components/Button.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'
import { options } from '@/ui/state'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]

const setupOpen = ref(false)

function setMcpEnabled(enabled: boolean | undefined): void {
  if (enabled) {
    window.dispatchEvent(new Event(MCP_PERMISSION_REQUEST_EVENT))
  }
  options.value.mcpOn = enabled === true
}
</script>

<template>
  <Section class="tp-agent-integration" flat>
    <template #header>
      <div class="tp-row">Agent integration</div>
    </template>

    <div class="tp-grid tp-grid-2">
      <label>MCP access</label>
      <SegmentedControl
        class="tp-grid-end"
        :options="mcpOptions"
        :model-value="options.mcpOn"
        @update:model-value="setMcpEnabled"
      />
    </div>

    <div v-if="options.mcpOn" class="tp-grid">
      <Button class="tp-agent-setup-button" @click="setupOpen = true">Set up agents</Button>
    </div>

    <AgentSetupDialog v-model="setupOpen" />
  </Section>
</template>

<style scoped>
label {
  cursor: default;
  color: var(--color-text-secondary);
}

.tp-agent-setup-button {
  width: 100%;
}
</style>
