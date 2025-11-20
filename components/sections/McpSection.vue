<script setup lang="ts">
import { computed } from 'vue'
import IconButton from '@/components/IconButton.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import Copy from '@/components/icons/Copy.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Claude from '@/components/icons/brands/Claude.vue'
import Cline from '@/components/icons/brands/Cline.vue'
import Cursor from '@/components/icons/brands/Cursor.vue'
import Trae from '@/components/icons/brands/TRAE.vue'
import VSCode from '@/components/icons/brands/VSCode.vue'
import Windsurf from '@/components/icons/brands/Windsurf.vue'
import Zed from '@/components/icons/brands/Zed.vue'
import { MCP_CLIENTS } from '@/utils'
import { options } from '@/ui/state'

import type { McpClientId } from '@/utils'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]

const BRAND_COLORS: Partial<Record<McpClientId, string>> = {
  vscode: '#0098FF',
  cursor: '#000000',
  windsurf: '#0B100F',
  claude: '#D97757',
  trae: '#000000',
  zed: '#084CCF',
  cline: '#000000'
}

const CLIENT_ICONS: Record<McpClientId, unknown> = {
  vscode: VSCode,
  cursor: Cursor,
  windsurf: Windsurf,
  claude: Claude,
  trae: Trae,
  zed: Zed,
  cline: Cline
}

const mcpClients = computed(() =>
  MCP_CLIENTS.map((client) => ({
    ...client,
    icon: CLIENT_ICONS[client.id],
    brandColor: BRAND_COLORS[client.id]
  }))
)

function handleClientClick(deepLink?: string, supported?: boolean) {
  if (!supported || !deepLink) return
  window.open(deepLink, '_self')
}
</script>

<template>
  <Section title="MCP server" class="tp-mcp-section" flat>
    <div class="tp-row tp-row-justify tp-mcp-field">
      <label>Enable MCP server</label>
      <SegmentedControl :options="mcpOptions" v-model="options.mcpOn" />
    </div>
    <div v-if="options.mcpOn" class="tp-row tp-row-justify tp-mcp-field">
      <div class="tp-row tp-mcp-clients">
        <IconButton
          v-for="client in mcpClients"
          :key="client.name"
          :title="client.name"
          variant="secondary"
          class="tp-mcp-client-button"
          :style="client.brandColor ? { '--tp-mcp-client-hover-color': client.brandColor } : null"
          @click="handleClientClick(client.deepLink, client.supportsDeepLink)"
        >
          <component :is="client.icon" class="tp-mcp-client-icon" />
        </IconButton>
        <IconButton title="Copy" class="tp-mcp-client-button" variant="secondary">
          <Copy />
        </IconButton>
      </div>
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

.tp-mcp-clients {
  flex-wrap: wrap;
}

.tp-mcp-client-icon {
  --icon-button-size: 14px !important;
}

.tp-mcp-client-button:hover {
  --color-icon: var(--tp-mcp-client-hover-color, var(--color-icon)) !important;
}
</style>
