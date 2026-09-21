<script setup lang="ts">
import type {
  AgentIntegrationAction,
  AgentIntegrationConfig,
  AgentIntegrationId
} from '@tempad-dev/shared'

import {
  AGENT_INTEGRATIONS,
  AGENT_SKILLS_INSTALL_COMMAND,
  MCP_SERVERS_CONFIG_SNIPPET
} from '@tempad-dev/shared'
import { ArrowUpRight, Check, Copy, ExternalLink } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import ActionButton from '@/components/ActionButton.vue'
import BrandIcon from '@/components/BrandIcon.vue'
import SectionShell from '@/components/SectionShell.vue'
import SkillLink from '@/components/SkillLink.vue'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import { AGENT_SETUP_SHOT, SITE_LINKS, type SiteSkill } from '@/content/landing'

type FeedbackKind = 'success' | 'info' | 'error'
type SetupTarget = Pick<AgentIntegrationConfig, 'name' | 'actions'> & {
  id: AgentIntegrationId | 'other'
}
const agents: SetupTarget[] = [
  ...AGENT_INTEGRATIONS,
  {
    id: 'other',
    name: 'Manual setup',
    actions: [
      { id: 'mcp-config', label: 'MCP config', kind: 'config', value: MCP_SERVERS_CONFIG_SNIPPET },
      {
        id: 'skill-cli',
        label: 'Agent skills',
        kind: 'command',
        value: AGENT_SKILLS_INSTALL_COMMAND
      }
    ]
  }
]
const emit = defineEmits<{ 'open-skill': [skill: SiteSkill] }>()
const feedback = ref<{ kind: FeedbackKind; text: string } | null>(null)
const copiedText = ref<string | null>(null)
const selectedAgentId = ref<SetupTarget['id']>('codex')
const selectedAgent = computed(() => agents.find(({ id }) => id === selectedAgentId.value)!)
const hasPlugin = computed(() =>
  selectedAgent.value.actions.some(({ id }) => id.startsWith('plugin-'))
)
const setupGroups = computed(() => {
  const { actions } = selectedAgent.value
  if (hasPlugin.value) {
    return [
      {
        id: 'plugin',
        title: 'Agent Plugin',
        copy: 'Connects your agent to Figma for native design editing and code implementation.',
        actions: actions.filter(({ id }) => id.startsWith('plugin-'))
      }
    ]
  }

  return [
    {
      id: 'mcp',
      title: 'MCP server',
      copy: `Lets ${selectedAgentId.value === 'other' ? 'your agent' : selectedAgent.value.name} read the open Figma file and edit its canvas when you have edit access.`,
      actions: actions.filter(({ id }) => id.startsWith('mcp-'))
    },
    {
      id: 'skills',
      title: 'Agent skills',
      copy: 'Adds guidance for editing native Figma designs and implementing UI in your project.',
      actions: actions.filter(({ id }) => id.startsWith('skill-'))
    }
  ]
})
const { resolvedColorMode } = useSiteColorMode()
let feedbackTimer: number | undefined

function showFeedback(text: string, kind: FeedbackKind = 'success'): void {
  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }

  feedback.value = { kind, text }
  feedbackTimer = window.setTimeout(() => {
    feedback.value = null
    copiedText.value = null
  }, 2400)
}

async function writeClipboard(text: string, successMessage: string): Promise<void> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', '')
      textarea.style.position = 'absolute'
      textarea.style.left = '-9999px'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }

    copiedText.value = text
    showFeedback(successMessage)
  } catch {
    showFeedback('Clipboard access failed. Please copy it manually.', 'error')
  }
}

function openDeepLink(action: AgentIntegrationAction, agent: SetupTarget): void {
  let cleaned = false

  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    window.clearTimeout(timeoutId)
    window.removeEventListener('blur', cleanup)
    window.removeEventListener('pagehide', cleanup)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      cleanup()
    }
  }

  const timeoutId = window.setTimeout(() => {
    cleanup()

    if (action.fallbackValue) {
      window.location.href = action.fallbackValue
      showFeedback(`Trying the fallback install link for ${agent.name}…`, 'info')
      return
    }

    showFeedback(`No response from ${agent.name}. Install it first, then try again.`, 'info')
  }, 850)

  window.addEventListener('blur', cleanup, { once: true })
  window.addEventListener('pagehide', cleanup, { once: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)

  window.location.href = action.value
}

function handleAgentAction(action: AgentIntegrationAction, agent: SetupTarget): void {
  if (action.kind === 'deep-link') {
    openDeepLink(action, agent)
    return
  }

  const message = action.kind === 'config' ? 'Copied MCP config.' : 'Copied setup command.'
  void writeClipboard(action.value, message)
}

function selectAdjacentAgent(direction: -1 | 1): void {
  const index = agents.findIndex(({ id }) => id === selectedAgentId.value)
  selectedAgentId.value = agents[(index + direction + agents.length) % agents.length]!.id
  void nextTick(() => document.getElementById(`site-agent-${selectedAgentId.value}`)?.focus())
}

function selectManualSetup(): void {
  selectedAgentId.value = 'other'
  void nextTick(() => document.getElementById('site-agent-other')?.focus())
}

function getCopyHint(action: AgentIntegrationAction, index: number): string {
  if (index > 0) {
    if (action.id === 'skill-canvas-authoring-cli') return 'Then run in your terminal:'
    return action.kind === 'config' ? 'Or configure manually:' : 'Or run in your terminal:'
  }
  return action.kind === 'config' ? "Copy into your agent's MCP settings:" : 'Run in your terminal:'
}

onBeforeUnmount(() => {
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
})
</script>

<template>
  <SectionShell id="connect" title="Set up TemPad Dev">
    <div class="site-connect-workbench">
      <div class="site-extension-setup">
        <div class="site-connect-intro">
          <h3 class="site-connect-stage-title">Start in Figma</h3>
          <p>Open a Figma file, then enable MCP access in Preferences → Agent integration.</p>
          <ActionButton :href="SITE_LINKS.install" external>
            <ExternalLink aria-hidden="true" /><span>Install extension</span>
          </ActionButton>
          <p class="site-connect-row-copy">
            Keep the Figma file and TemPad Dev open while your agent works.
          </p>
        </div>
        <figure class="site-setup-figure">
          <img
            class="site-shot-image"
            :src="AGENT_SETUP_SHOT[resolvedColorMode]"
            :alt="AGENT_SETUP_SHOT.alt"
            :width="AGENT_SETUP_SHOT.width"
            :height="AGENT_SETUP_SHOT.height"
            loading="lazy"
          />
        </figure>
      </div>
      <div class="site-agent-setup">
        <div class="site-connect-stage-head">
          <h3 class="site-connect-stage-title">Connect your agent</h3>
          <span class="site-active-agent-name">{{ selectedAgent.name }}</span>
        </div>
        <div class="site-agent-logos" role="tablist" aria-label="Coding agent">
          <button
            v-for="agent in agents"
            :id="`site-agent-${agent.id}`"
            :key="agent.id"
            type="button"
            role="tab"
            class="site-agent-logo-button"
            :class="{ 'site-agent-other-button': agent.id === 'other' }"
            :aria-label="agent.id === 'other' ? 'Other agents' : agent.name"
            :title="agent.id === 'other' ? 'Other agents' : agent.name"
            :aria-selected="selectedAgentId === agent.id"
            aria-controls="site-agent-configuration"
            :tabindex="selectedAgentId === agent.id ? 0 : -1"
            @click="selectedAgentId = agent.id"
            @keydown.left.prevent="selectAdjacentAgent(-1)"
            @keydown.right.prevent="selectAdjacentAgent(1)"
          >
            <span v-if="agent.id === 'other'">Other agents</span>
            <BrandIcon v-else :client-id="agent.id" />
          </button>
        </div>
        <p class="site-connect-requirement">Node.js 22.x, 24.x, or 26+ required.</p>
        <div
          id="site-agent-configuration"
          class="site-setup-options"
          role="tabpanel"
          :aria-labelledby="`site-agent-${selectedAgentId}`"
          tabindex="0"
        >
          <div class="site-setup-group-heading">
            <p v-if="hasPlugin" class="site-connect-row-copy">
              Install the TemPad Dev plugin to work with Figma from your coding agent.
            </p>
            <p v-else-if="selectedAgentId === 'other'" class="site-connect-row-copy">
              Connect a compatible coding agent to Figma, then install the two skills.
            </p>
            <p v-else class="site-connect-row-copy">
              Connect the MCP server, then add both agent skills.
            </p>
            <h4>{{ hasPlugin ? 'Recommended' : 'Setup steps' }}</h4>
          </div>
          <section
            v-for="(group, stepIndex) in setupGroups"
            :key="group.id"
            class="site-setup-group"
          >
            <div class="site-setup-group-heading">
              <h4>
                <span v-if="!hasPlugin">{{ stepIndex + 1 }}. </span>{{ group.title }}
              </h4>
              <p class="site-connect-row-copy">{{ group.copy }}</p>
            </div>
            <div class="site-setup-group-actions">
              <div
                v-for="(action, actionIndex) in group.actions"
                :key="action.id"
                class="site-setup-action"
              >
                <ActionButton
                  v-if="action.kind === 'deep-link'"
                  type="button"
                  variant="secondary"
                  class="site-connect-action-button"
                  @click="handleAgentAction(action, selectedAgent)"
                >
                  <ExternalLink aria-hidden="true" />
                  <span>Install in {{ selectedAgent.name }}</span>
                </ActionButton>
                <template v-else>
                  <p class="site-connect-row-copy">{{ getCopyHint(action, actionIndex) }}</p>
                  <div class="site-setup-command">
                    <pre :aria-label="action.label"><code>{{ action.value }}</code></pre>
                    <button
                      type="button"
                      class="site-command-copy"
                      :aria-label="`Copy ${action.label}`"
                      :title="copiedText === action.value ? 'Copied' : `Copy ${action.label}`"
                      @click="handleAgentAction(action, selectedAgent)"
                    >
                      <Check v-if="copiedText === action.value" aria-hidden="true" />
                      <Copy v-else aria-hidden="true" />
                    </button>
                  </div>
                </template>
              </div>
            </div>
          </section>
          <p v-if="hasPlugin" class="site-setup-alternative">
            Setting up an agent without plugin support? Use
            <button type="button" class="site-text-link" @click="selectManualSetup">
              Manual setup</button
            >.
          </p>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="site-skill-links">
        <SkillLink skill="canvas" @click="emit('open-skill', 'canvas')" />
        <SkillLink skill="code" @click="emit('open-skill', 'code')" />
      </div>
      <a class="site-text-link" :href="SITE_LINKS.agentGuide" target="_blank" rel="noopener">
        Setup guide <ArrowUpRight aria-hidden="true" />
      </a>
    </template>
    <Transition name="site-feedback-popup">
      <p
        v-if="feedback"
        class="site-feedback site-feedback-popup"
        :class="`is-${feedback.kind}`"
        aria-live="polite"
      >
        {{ feedback.text }}
      </p>
    </Transition>
  </SectionShell>
</template>
