<script setup lang="ts">
import { computed, ref } from 'vue'
import { useCopy } from '@/composables'
import IconButton from '@/components/IconButton.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import Copy from '@/components/icons/Copy.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Claude from '@/components/icons/brands/Claude.vue'
import Cursor from '@/components/icons/brands/Cursor.vue'
import OpenAI from '@/components/icons/brands/OpenAI.vue'
import Trae from '@/components/icons/brands/TRAE.vue'
import VSCode from '@/components/icons/brands/VSCode.vue'
import Windsurf from '@/components/icons/brands/Windsurf.vue'
import Expanded from '@/components/icons/Expanded.vue'
import Collapsed from '@/components/icons/Collapsed.vue'
import { MCP_CLIENTS, MCP_SERVER } from '@/mcp/config'
import { options } from '@/ui/state'

import type { McpClientConfig, McpClientId } from '@/mcp/config'
import ExternalLink from '../icons/ExternalLink.vue'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]

const clientsExpanded = ref(false)

const CLIENT_ICONS: Record<McpClientId, unknown> = {
  vscode: VSCode,
  cursor: Cursor,
  windsurf: Windsurf,
  claude: Claude,
  codex: OpenAI,
  trae: Trae
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
const copyMessages = {
  command: 'Copied command to clipboard',
  config: 'Copied configuration to clipboard'
} as const

async function handleClientClick(client: McpClientConfig & { icon: unknown; brandColor?: string }) {
  if (client.deepLink) {
    window.open(client.deepLink, '_self')
    return
  }
  if (client.copyText) {
    const kind = client.copyKind === 'config' ? 'config' : 'command'
    copy(client.copyText, copyMessages[kind])
  }
}
</script>

<template>
  <Section class="tp-mcp-section" flat>
    <template #header>
      <div class="tp-row">MCP server</div>
    </template>
    <div class="tp-row tp-row-justify tp-mcp-field">
      <label>Enable MCP server</label>
      <SegmentedControl :options="mcpOptions" v-model="options.mcpOn" />
    </div>
    <template v-if="options.mcpOn">
      <button
        type="button"
        class="tp-row tp-mcp-toggle"
        :aria-expanded="clientsExpanded"
        @click="clientsExpanded = !clientsExpanded"
      >
        <component :is="clientsExpanded ? Expanded : Collapsed" class="tp-mcp-toggle-icon" />
        <span>Install</span>
      </button>
      <div v-if="clientsExpanded" class="tp-mcp-install-section">
        <div class="tp-mcp-description">
          Configure your editor/agent to run the MCP server. You can use a quick setup below.
        </div>
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
            @click="copy(defaultInstallCommand, copyMessages.command)"
          >
            <Copy />
          </IconButton>
        </div>
        <div class="tp-row">
          <a
            target="_blank"
            rel="noopener"
            class="tp-mcp-link"
            href="https://github.com/ecomfe/tempad-dev"
          >
            <ExternalLink />
            View setup guide
          </a>
        </div>
      </div>
    </template>
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

.tp-mcp-install-section {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tp-mcp-clients {
  flex-wrap: wrap;
  gap: 2px;
}

.tp-mcp-client-icon {
  --icon-button-size: 14px !important;
}

.tp-mcp-client-button:hover {
  --color-icon: var(--tp-mcp-client-hover-color, var(--color-icon)) !important;
}

.tp-mcp-toggle {
  position: relative;
  margin-top: 8px;
  color: var(--color-text-secondary);
}

.tp-mcp-toggle-icon {
  position: absolute;
  left: -16px;
  --color-icon: var(--color-text-secondary);
}

.tp-mcp-description {
  color: var(--color-text-secondary);
  line-height: 16px;
  letter-spacing: calc(0.005px + var(--text-tracking-pos, 0) * 11px);
}

.tp-mcp-link {
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-2);
  height: 24px;
  outline: none;
  outline-offset: 0;
  border-radius: var(--radius-small);
  text-decoration: none;
  color: var(--color-text-brand);
  cursor: pointer;
}
</style>
