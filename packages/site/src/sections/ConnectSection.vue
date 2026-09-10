<script setup lang="ts">
import type {
  AgentIntegrationAction,
  AgentIntegrationConfig,
  AgentIntegrationId
} from '@tempad-dev/shared'

import { AGENT_INTEGRATIONS } from '@tempad-dev/shared'
import { Check, Copy, ExternalLink } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import ActionButton from '@/components/ActionButton.vue'
import BrandIcon from '@/components/BrandIcon.vue'
import SectionShell from '@/components/SectionShell.vue'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import { AGENT_SETUP_SHOT, SITE_LINKS, type SiteSkill } from '@/content/landing'

type FeedbackKind = 'success' | 'info' | 'error'
const agents = AGENT_INTEGRATIONS
const emit = defineEmits<{ 'open-skill': [skill: SiteSkill] }>()
const feedback = ref<{ kind: FeedbackKind; text: string } | null>(null)
const copiedText = ref<string | null>(null)
const selectedAgentId = ref<AgentIntegrationId>('codex')
const selectedAgent = computed(() => agents.find(({ id }) => id === selectedAgentId.value)!)
const pluginInstallLink = computed(() =>
  selectedAgent.value.actions.find(({ id }) => id === 'plugin-prompt')
)
const setupGroups = computed(() => {
  const { actions } = selectedAgent.value
  const pluginCommand = actions.find(({ id }) => id === 'plugin-cli')
  if (pluginCommand) {
    return [
      {
        id: 'plugin',
        title: 'Install the Agent Plugin',
        copy: 'Run in your terminal. Includes MCP and both skills.',
        actions: [pluginCommand]
      }
    ]
  }

  return [
    {
      id: 'mcp',
      title: 'Connect MCP',
      copy: actions.some(({ kind }) => kind === 'config')
        ? 'Add this to your OpenCode configuration.'
        : actions.some(({ id }) => id === 'mcp-deep-link')
          ? 'Add TemPad Dev in your agent.'
          : 'Run in your terminal.',
      actions: actions.filter(({ id }) => id.startsWith('mcp-'))
    },
    {
      id: 'skills',
      title: 'Install both skills',
      copy: 'Run in your terminal for canvas authoring and design-to-code.',
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

function openDeepLink(action: AgentIntegrationAction, agent: AgentIntegrationConfig): void {
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

function handleAgentAction(action: AgentIntegrationAction, agent: AgentIntegrationConfig): void {
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
            :aria-label="agent.name"
            :title="agent.name"
            :aria-selected="selectedAgentId === agent.id"
            aria-controls="site-agent-configuration"
            :tabindex="selectedAgentId === agent.id ? 0 : -1"
            @click="selectedAgentId = agent.id"
            @keydown.left.prevent="selectAdjacentAgent(-1)"
            @keydown.right.prevent="selectAdjacentAgent(1)"
          >
            <BrandIcon :client-id="agent.id" />
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
          <section v-for="group in setupGroups" :key="group.id" class="site-setup-group">
            <div class="site-setup-group-heading">
              <h4>{{ group.title }}</h4>
              <p class="site-connect-row-copy">{{ group.copy }}</p>
            </div>
            <div class="site-setup-group-actions">
              <div v-for="action in group.actions" :key="action.id" class="site-setup-action">
                <ActionButton
                  v-if="action.kind === 'deep-link'"
                  type="button"
                  variant="secondary"
                  class="site-connect-action-button"
                  @click="handleAgentAction(action, selectedAgent)"
                >
                  <ExternalLink aria-hidden="true" />
                  <span>Install MCP in {{ selectedAgent.name }}</span>
                </ActionButton>
                <div v-else class="site-setup-command">
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
              </div>
              <p v-if="group.id === 'plugin' && pluginInstallLink" class="site-setup-alternative">
                Or
                <button
                  type="button"
                  class="site-text-link"
                  @click="handleAgentAction(pluginInstallLink, selectedAgent)"
                >
                  open {{ selectedAgent.name }} to install it →
                </button>
              </p>
            </div>
          </section>
        </div>
        <div class="site-setup-resources">
          <div class="site-skill-links">
            <button type="button" class="site-text-link" @click="emit('open-skill', 'canvas')">
              Canvas skill
            </button>
            <button type="button" class="site-text-link" @click="emit('open-skill', 'code')">
              Design-to-code skill
            </button>
          </div>
          <a class="site-text-link" :href="SITE_LINKS.agentGuide" target="_blank" rel="noopener"
            >Setup guide →</a
          >
        </div>
      </div>
    </div>
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
