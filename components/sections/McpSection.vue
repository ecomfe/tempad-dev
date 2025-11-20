<script setup lang="ts">
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import { options } from '@/ui/state'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]
</script>

<template>
  <Section title="MCP server" class="tp-mcp-section" flat>
    <div class="tp-row tp-row-justify tp-mcp-field">
      <label>Enable MCP server</label>
      <SegmentedControl :options="mcpOptions" v-model="options.mcpOn" />
    </div>
  </Section>
</template>

<style scoped>
.tp-mcp-field + .tp-mcp-field {
  margin-top: 8px;
}

label {
  cursor: default;
  color: var(--color-text-secondary);
}
</style>
