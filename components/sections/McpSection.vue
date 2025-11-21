<script setup lang="ts">
import { computed } from 'vue'
import { useCopy } from '@/composables'
import IconButton from '@/components/IconButton.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import Copy from '@/components/icons/Copy.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Claude from '@/components/icons/brands/Claude.vue'
import Cline from '@/components/icons/brands/Cline.vue'
import Cursor from '@/components/icons/brands/Cursor.vue'
import OpenAI from '@/components/icons/brands/OpenAI.vue'
import Trae from '@/components/icons/brands/TRAE.vue'
import VSCode from '@/components/icons/brands/VSCode.vue'
import Windsurf from '@/components/icons/brands/Windsurf.vue'
import Zed from '@/components/icons/brands/Zed.vue'
import { MCP_CLIENTS, MCP_SERVER } from '@/utils'
import { options } from '@/ui/state'

import type { McpClientConfig, McpClientId } from '@/utils'
import Help from '../icons/Help.vue'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]

const CLIENT_ICONS: Record<McpClientId, unknown> = {
  vscode: VSCode,
  cursor: Cursor,
  windsurf: Windsurf,
  claude: Claude,
  codex: OpenAI,
  trae: Trae,
  zed: Zed,
  cline: Cline
}

const mcpClients = computed(() =>
  MCP_CLIENTS.map((client) => ({
    ...client,
    icon: CLIENT_ICONS[client.id],
    brandColor: client.brandColor,
    tooltip: client.deepLink
      ? `Install in ${client.name}`
      : client.copyKind === 'command'
        ? `Copy command for ${client.name}`
        : client.copyKind === 'config'
          ? `Copy configuration for ${client.name}`
          : client.name
  }))
)

const copy = useCopy()
const defaultInstallCommand = `${MCP_SERVER.command} ${MCP_SERVER.args.join(' ')}`

async function handleClientClick(client: McpClientConfig & { icon: unknown; brandColor?: string }) {
  if (client.deepLink) {
    window.open(client.deepLink, '_self')
    return
  }
  if (client.copyText) {
    copy(client.copyText)
  }
}
</script>

<template>
  <Section class="tp-mcp-section" flat>
    <template #header>
      <div class="tp-row">MCP server</div>
      <IconButton variant="secondary" toggle="subtle" title="Show help">
        <Help />
      </IconButton>
    </template>
    <div class="tp-row tp-row-justify tp-mcp-field">
      <label>Enable MCP server</label>
      <SegmentedControl :options="mcpOptions" v-model="options.mcpOn" />
    </div>
    <div v-if="options.mcpOn" class="tp-row tp-row-justify tp-mcp-field">
      <div class="tp-row tp-mcp-clients">
        <IconButton
          v-for="client in mcpClients"
          :key="client.name"
          :title="client.tooltip"
          variant="secondary"
          class="tp-mcp-client-button"
          :style="client.brandColor ? { '--tp-mcp-client-hover-color': client.brandColor } : null"
          @click="handleClientClick(client)"
        >
          <component :is="client.icon" class="tp-mcp-client-icon" />
        </IconButton>
        <IconButton
          title="Copy configuration"
          class="tp-mcp-client-button"
          variant="secondary"
          @click="copy(defaultInstallCommand)"
        >
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
