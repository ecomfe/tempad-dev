<script setup lang="ts">
import { computed, ref } from 'vue'

import type { McpClientConfig, McpClientId } from '@/mcp/config'

import IconButton from '@/components/IconButton.vue'
import Claude from '@/components/icons/brands/Claude.vue'
import Codex from '@/components/icons/brands/Codex.vue'
import Cursor from '@/components/icons/brands/Cursor.vue'
import Trae from '@/components/icons/brands/TRAE.vue'
import VSCode from '@/components/icons/brands/VSCode.vue'
import Windsurf from '@/components/icons/brands/Windsurf.vue'
import Collapsed from '@/components/icons/Collapsed.vue'
import Copy from '@/components/icons/Copy.vue'
import Expanded from '@/components/icons/Expanded.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useCopy, useDeepLinkGuard } from '@/composables'
import { MCP_CLIENTS, MCP_SERVER } from '@/mcp/config'
import { options } from '@/ui/state'

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
  codex: Codex,
  trae: Trae
}

type McpClientDisplay = Omit<McpClientConfig, 'brandColor'> & {
  brandColor?: string
  icon: unknown
  tooltip: string
}

function resolveBrandColor(brandColor: McpClientConfig['brandColor'], theme: 'light' | 'dark') {
  if (!brandColor) return undefined
  if (Array.isArray(brandColor)) {
    const [lightColor, darkColor] = brandColor
    return theme === 'dark' ? (darkColor ?? lightColor) : (lightColor ?? darkColor)
  }
  return brandColor
}

const brandColorsByTheme = computed(() => {
  const light = {} as Record<McpClientId, string>
  const dark = {} as Record<McpClientId, string>

  MCP_CLIENTS.forEach((client) => {
    light[client.id] = resolveBrandColor(client.brandColor, 'light') ?? ''
    dark[client.id] = resolveBrandColor(client.brandColor, 'dark') ?? ''
  })

  return { light, dark }
})

const mcpClients = computed(() =>
  MCP_CLIENTS.map((client) => {
    const { brandColor, ...rest } = client

    return {
      ...rest,
      icon: CLIENT_ICONS[client.id],
      tooltip: client.deepLink
        ? `Install in ${client.name}`
        : client.copyKind === 'command'
          ? `Copy command for ${client.name}`
          : client.copyKind === 'config'
            ? `Copy configuration for ${client.name}`
            : client.name
    } satisfies McpClientDisplay
  })
)

const copy = useCopy()
const guardDeepLink = useDeepLinkGuard({ timeout: 800 })
const defaultConfig = JSON.stringify(
  {
    [MCP_SERVER.name]: {
      command: MCP_SERVER.command,
      args: MCP_SERVER.args
    }
  },
  null,
  2
)
const skillInstallCommand =
  'npx add-skill https://github.com/ecomfe/tempad-dev/tree/main/skill --skill implementing-figma-ui-tempad-dev'
const copyMessages = {
  command: 'Copied command to clipboard',
  config: 'Copied configuration to clipboard'
} as const

async function handleClientClick(client: McpClientDisplay) {
  if (client.deepLink) {
    guardDeepLink(client.deepLink, {
      message: `No response from ${client.name}. Please install it first.`,
      fallbackDeepLink: client.fallbackDeepLink
    })
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
        <div class="tp-row tp-row-justify tp-mcp-field">
          <label>Agent skill</label>
          <IconButton
            variant="secondary"
            title="Copy add-skill command"
            class="tp-mcp-client-button"
            @click="copy(skillInstallCommand, copyMessages.command)"
          >
            <Copy />
          </IconButton>
        </div>
        <div class="tp-mcp-description">
          Configure your editor/agent to run the MCP server. You can use a quick setup below.
        </div>
        <div class="tp-row tp-mcp-clients">
          <IconButton
            v-for="client in mcpClients"
            :key="client.name"
            variant="secondary"
            :title="client.tooltip"
            class="tp-mcp-client-button"
            :style="{
              '--tp-mcp-client-hover-color': `var(--brand-color-${client.id})`
            }"
            @click="handleClientClick(client)"
          >
            <component :is="client.icon" class="tp-mcp-client-icon" />
          </IconButton>
          <IconButton
            variant="secondary"
            title="Copy configuration"
            class="tp-mcp-client-button"
            @click="copy(defaultConfig, copyMessages.config)"
          >
            <Copy />
          </IconButton>
        </div>
        <div class="tp-row">
          <a
            target="_blank"
            rel="noopener"
            class="tp-mcp-link"
            href="https://github.com/ecomfe/tempad-dev#mcp-server"
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
:global([data-preferred-theme='light'] .tp-mcp-section) {
  --brand-color-vscode: v-bind('brandColorsByTheme.light.vscode');
  --brand-color-cursor: v-bind('brandColorsByTheme.light.cursor');
  --brand-color-windsurf: v-bind('brandColorsByTheme.light.windsurf');
  --brand-color-claude: v-bind('brandColorsByTheme.light.claude');
  --brand-color-codex: v-bind('brandColorsByTheme.light.codex');
  --brand-color-trae: v-bind('brandColorsByTheme.light.trae');
}

:global([data-preferred-theme='dark'] .tp-mcp-section) {
  --brand-color-vscode: v-bind('brandColorsByTheme.dark.vscode');
  --brand-color-cursor: v-bind('brandColorsByTheme.dark.cursor');
  --brand-color-windsurf: v-bind('brandColorsByTheme.dark.windsurf');
  --brand-color-claude: v-bind('brandColorsByTheme.dark.claude');
  --brand-color-codex: v-bind('brandColorsByTheme.dark.codex');
  --brand-color-trae: v-bind('brandColorsByTheme.dark.trae');
}

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
  --icon-button-icon: var(--tp-mcp-client-hover-color) !important;
}

.tp-mcp-client-button:last-child {
  margin-left: auto;
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
