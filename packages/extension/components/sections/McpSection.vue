<script setup lang="ts">
import { computed, ref } from 'vue'

import type {
  AgentIntegrationAction,
  AgentIntegrationConfig,
  AgentIntegrationId
} from '@/mcp/config'

import IconButton from '@/components/IconButton.vue'
import BrandIcon from '@/components/icons/brands/BrandIcon.vue'
import Collapsed from '@/components/icons/Collapsed.vue'
import Copy from '@/components/icons/Copy.vue'
import Ellipsis from '@/components/icons/Ellipsis.vue'
import Expanded from '@/components/icons/Expanded.vue'
import Minus from '@/components/icons/Minus.vue'
import Tick from '@/components/icons/Tick.vue'
import Section from '@/components/Section.vue'
import SegmentedControl from '@/components/SegmentedControl.vue'
import { useCopy, useDeepLinkGuard } from '@/composables'
import {
  AGENT_INTEGRATIONS,
  AGENT_INTEGRATIONS_BY_ID,
  AGENT_SKILL_INSTALL_COMMAND,
  MCP_CLIENTS_BY_ID,
  MCP_SERVERS_CONFIG_SNIPPET
} from '@/mcp/config'
import { MCP_PERMISSION_REQUEST_EVENT } from '@/mcp/permissions'
import { options } from '@/ui/state'

import ExternalLink from '../icons/ExternalLink.vue'

const mcpOptions = [
  { label: 'Disabled', value: false, icon: Minus },
  { label: 'Enabled', value: true, icon: Tick }
]

const agentColors = Object.fromEntries(
  AGENT_INTEGRATIONS.map(({ id }) => {
    const color = MCP_CLIENTS_BY_ID[id].brandColor
    const light = Array.isArray(color) ? color[0] : color

    return [id, { light, dark: Array.isArray(color) ? (color[1] ?? color[0]) : color }]
  })
) as Record<(typeof AGENT_INTEGRATIONS)[number]['id'], { light?: string; dark?: string }>

type SetupTarget = Pick<AgentIntegrationConfig, 'actions' | 'name'> & {
  id: AgentIntegrationId | 'other'
}

const otherSetup = {
  id: 'other',
  name: 'Other agent',
  actions: [
    {
      id: 'mcp-config',
      label: 'MCP config',
      kind: 'config',
      value: MCP_SERVERS_CONFIG_SNIPPET
    },
    {
      id: 'skill-cli',
      label: 'Agent skill',
      kind: 'command',
      value: AGENT_SKILL_INSTALL_COMMAND
    }
  ]
} satisfies SetupTarget

const setupExpanded = ref(false)
const selectedTargetId = ref<SetupTarget['id'] | null>(null)
const selectedSetup = computed<SetupTarget | null>(() => {
  const id = selectedTargetId.value
  if (!id) return null
  return id === 'other' ? otherSetup : AGENT_INTEGRATIONS_BY_ID[id]
})

const copy = useCopy()
const guardDeepLink = useDeepLinkGuard({ timeout: 800 })

function setMcpEnabled(enabled: boolean | undefined): void {
  if (enabled) {
    window.dispatchEvent(new Event(MCP_PERMISSION_REQUEST_EVENT))
  }
  options.value.mcpOn = enabled === true
}

function handleSetupAction(
  action: Pick<AgentIntegrationAction, 'fallbackValue' | 'kind' | 'value'>,
  agentName?: string
): void {
  if (action.kind === 'deep-link') {
    guardDeepLink(action.value, {
      message: `No response from ${agentName}. Please install it first.`,
      fallbackDeepLink: action.fallbackValue
    })
    return
  }

  const message = action.kind === 'command' ? 'Copied setup command' : 'Copied MCP configuration'
  copy(action.value, message)
}

function setSetupTarget(id: SetupTarget['id'], selected: boolean | undefined): void {
  selectedTargetId.value = selected === true ? id : null
}

function getActionTitle(action: AgentIntegrationAction, agentName: string): string {
  const verb = action.kind === 'deep-link' ? 'Open' : 'Copy'
  return `${verb} ${action.label} for ${agentName}`
}
</script>

<template>
  <Section class="tp-mcp-section" flat>
    <template #header>
      <div class="tp-row">Agent integration</div>
    </template>

    <div class="tp-grid tp-grid-2 tp-mcp-field">
      <label>MCP access</label>
      <SegmentedControl
        class="tp-grid-end"
        :options="mcpOptions"
        :model-value="options.mcpOn"
        @update:model-value="setMcpEnabled"
      />
    </div>

    <template v-if="options.mcpOn">
      <button
        type="button"
        class="tp-row tp-mcp-toggle"
        :aria-expanded="setupExpanded"
        @click="setupExpanded = !setupExpanded"
      >
        <component :is="setupExpanded ? Expanded : Collapsed" class="tp-mcp-toggle-icon" />
        <span>Agent setup</span>
      </button>

      <div v-if="setupExpanded" class="tp-mcp-setup">
        <div class="tp-row tp-mcp-agents" role="group" aria-label="Setup target">
          <IconButton
            v-for="agent in AGENT_INTEGRATIONS"
            :key="agent.id"
            toggle
            variant="secondary"
            class="tp-mcp-agent-button"
            :title="agent.name"
            :selected="selectedTargetId === agent.id"
            :style="{
              '--tp-mcp-agent-color-light': agentColors[agent.id].light,
              '--tp-mcp-agent-color-dark': agentColors[agent.id].dark
            }"
            @update:selected="setSetupTarget(agent.id, $event)"
          >
            <BrandIcon :id="agent.id" class="tp-mcp-agent-icon" />
          </IconButton>
          <IconButton
            toggle
            variant="secondary"
            class="tp-mcp-other-button"
            title="Other agent"
            :selected="selectedTargetId === 'other'"
            @update:selected="setSetupTarget('other', $event)"
          >
            <Ellipsis />
          </IconButton>
        </div>

        <div v-if="selectedSetup" class="tp-mcp-actions">
          <div
            v-for="action in selectedSetup.actions"
            :key="action.id"
            class="tp-row tp-row-justify tp-mcp-action"
          >
            <span>{{ action.label }}</span>
            <IconButton
              variant="secondary"
              :class="{ 'tp-mcp-deep-link-button': action.kind === 'deep-link' }"
              :title="getActionTitle(action, selectedSetup.name)"
              @click="handleSetupAction(action, selectedSetup.name)"
            >
              <ExternalLink v-if="action.kind === 'deep-link'" />
              <Copy v-else />
            </IconButton>
          </div>
        </div>

        <a
          target="_blank"
          rel="noopener"
          class="tp-mcp-link"
          href="https://github.com/ecomfe/tempad-dev#agent-integration"
        >
          <ExternalLink />
          Setup guide
        </a>
      </div>
    </template>
  </Section>
</template>

<style scoped>
label {
  cursor: default;
  color: var(--color-text-secondary);
}

.tp-mcp-setup {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tp-mcp-agents {
  gap: 2px;
}

.tp-mcp-agent-icon {
  width: 14px;
  height: 14px;
  color: var(--color-icon-secondary);
  filter: grayscale(1);
}

.tp-mcp-agent-button:hover .tp-mcp-agent-icon,
.tp-mcp-agent-button[aria-pressed='true'] .tp-mcp-agent-icon {
  color: var(--tp-mcp-agent-color-light);
  filter: none;
}

:global([data-preferred-theme='dark'] .tp-mcp-agent-button:hover .tp-mcp-agent-icon),
:global(
  [data-preferred-theme='dark'] .tp-mcp-agent-button[aria-pressed='true'] .tp-mcp-agent-icon
) {
  color: var(--tp-mcp-agent-color-dark);
}

.tp-mcp-other-button {
  margin-left: auto;
}

.tp-mcp-action {
  height: 24px;
  color: var(--color-text);
}

.tp-mcp-deep-link-button {
  --icon-button-icon-size: 16px;
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

.tp-mcp-link {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--spacer-2);
  height: 24px;
  outline: none;
  outline-offset: 0;
  border-radius: var(--radius-small);
  text-decoration: none;
  color: var(--color-text-brand);
  cursor: pointer;
}

.tp-mcp-link svg {
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
}
</style>
