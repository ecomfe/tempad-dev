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
import { ArrowUpRight, Check, Copy, Ellipsis, ExternalLink, Search, X } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'

import ActionButton from '@/components/ActionButton.vue'
import BrandIcon from '@/components/BrandIcon.vue'
import SectionShell from '@/components/SectionShell.vue'
import SkillLink from '@/components/SkillLink.vue'
import { useSiteColorMode } from '@/composables/useSiteColorMode'
import { AGENT_SETUP_SHOT, SITE_LINKS, type SiteSkill } from '@/content/landing'
import { searchAgents } from '@/utils/agent-search'

type FeedbackKind = 'success' | 'info' | 'error'
type SetupTarget = Pick<AgentIntegrationConfig, 'name' | 'actions' | 'docsUrl'> & {
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
const searchOpen = ref(false)
const searchQuery = ref('')
const searchInput = useTemplateRef<HTMLInputElement>('agentSearch')
const searchToggle = useTemplateRef<HTMLButtonElement>('searchToggle')
const filteredAgents = computed(() => searchAgents(agents, searchQuery.value))
const agentList = useTemplateRef<HTMLDivElement>('agentList')
let listAnimation: Animation | undefined
watch(filteredAgents, async () => {
  const list = agentList.value
  if (!list) return
  const height = list.getBoundingClientRect().height
  listAnimation?.cancel()
  await nextTick()
  if (!list.isConnected || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const nextHeight = list.getBoundingClientRect().height
  if (height !== nextHeight) {
    listAnimation = list.animate([{ height: `${height}px` }, { height: `${nextHeight}px` }], {
      duration: 320,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
    })
  }
})
const focusableAgentId = computed(() =>
  filteredAgents.value.some(({ id }) => id === selectedAgentId.value)
    ? selectedAgentId.value
    : filteredAgents.value[0]?.id
)
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
        title: 'Agent plugin',
        copy: 'Includes the Figma connection and both design and development skills.',
        actions: actions.filter(({ id }) => id.startsWith('plugin-'))
      }
    ]
  }

  return [
    {
      id: 'mcp',
      title: 'MCP server',
      copy: 'Connect your agent to the open Figma file. Canvas editing requires edit access.',
      actions: actions.filter(({ id }) => id.startsWith('mcp-'))
    },
    {
      id: 'skills',
      title: 'Agent skills',
      copy: 'Add guidance for designing in Figma and building in your project.',
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

function selectAdjacentAgent(direction: -1 | 1, currentId: SetupTarget['id']): void {
  const matches = filteredAgents.value
  const index = matches.findIndex(({ id }) => id === currentId)
  selectedAgentId.value = matches[(index + direction + matches.length) % matches.length]!.id
  void nextTick(() => document.getElementById(`site-agent-${selectedAgentId.value}`)?.focus())
}

async function toggleSearch(): Promise<void> {
  searchOpen.value = !searchOpen.value
  searchQuery.value = ''
  await nextTick()
  if (searchOpen.value) searchInput.value?.focus()
  else searchToggle.value?.focus()
}

function focusFirstResult(): void {
  const first = filteredAgents.value[0]
  if (first) document.getElementById(`site-agent-${first.id}`)?.focus()
}

function leaveAgent(element: Element): void {
  const tab = element as HTMLButtonElement
  // Preserve the old grid cell while the remaining tabs FLIP into their new positions.
  Object.assign(tab.style, {
    left: `${tab.offsetLeft}px`,
    top: `${tab.offsetTop}px`,
    width: `${tab.offsetWidth}px`
  })
  tab.inert = true
  tab.setAttribute('aria-hidden', 'true')
}

function enterAgent(element: Element): void {
  const tab = element as HTMLButtonElement
  for (const property of ['left', 'top', 'width']) tab.style.removeProperty(property)
  tab.inert = false
  tab.removeAttribute('aria-hidden')
}

function selectManualSetup(): void {
  searchQuery.value = ''
  selectedAgentId.value = 'other'
  void nextTick(() => document.getElementById('site-agent-other')?.focus())
}

function getCopyHint(action: AgentIntegrationAction, index: number): string {
  if (action.hint) return action.hint
  if (index > 0) {
    if (action.id === 'skill-canvas-authoring-cli') return 'Then run in your terminal:'
    return action.kind === 'config' ? 'Or configure manually:' : 'Or run in your terminal:'
  }
  return action.kind === 'config' ? "Copy into your agent's MCP settings:" : 'Run in your terminal:'
}

onBeforeUnmount(() => {
  if (feedbackTimer) window.clearTimeout(feedbackTimer)
  listAnimation?.cancel()
})
</script>

<template>
  <SectionShell id="connect" title="Set up TemPad Dev">
    <div class="site-connect-workbench">
      <div class="site-extension-setup">
        <div class="site-connect-intro">
          <h3 class="site-connect-stage-title">
            <span class="site-setup-step">01</span>Install the extension
          </h3>
          <ActionButton :href="SITE_LINKS.install" external>
            <ExternalLink aria-hidden="true" /><span>Install extension</span>
          </ActionButton>
          <p>
            Open a Figma file in your browser. In TemPad Dev, enable MCP access in
            <span class="site-settings-path">Preferences → Agent integration</span>.
          </p>
          <p class="site-connect-row-copy">
            Keep the file and extension open while your agent works.
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
          <h3 class="site-connect-stage-title">
            <span class="site-setup-step">02</span>Connect your agent
          </h3>
          <div class="site-agent-search-slot">
            <div class="site-agent-search" :class="{ 'is-open': searchOpen }">
              <button
                ref="searchToggle"
                class="site-agent-search-toggle"
                :inert="searchOpen"
                :aria-hidden="searchOpen"
                type="button"
                aria-label="Search agents"
                :aria-expanded="searchOpen"
                aria-controls="site-agent-search"
                @click="toggleSearch"
              >
                <Search aria-hidden="true" />
              </button>
              <div
                id="site-agent-search"
                class="site-agent-search-field"
                :inert="!searchOpen"
                :aria-hidden="!searchOpen"
              >
                <input
                  ref="agentSearch"
                  v-model="searchQuery"
                  type="search"
                  aria-label="Search agents by name"
                  placeholder="Search…"
                  autocomplete="off"
                  spellcheck="false"
                  @keydown.down.prevent="focusFirstResult"
                  @keydown.esc.prevent="toggleSearch"
                />
                <button type="button" aria-label="Close agent search" @click="toggleSearch">
                  <X aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div ref="agentList" class="site-agent-list">
          <TransitionGroup
            tag="div"
            name="site-agent-filter"
            class="site-agent-logos"
            role="tablist"
            aria-label="Coding agent"
            @keydown.esc="searchOpen && toggleSearch()"
            @before-leave="leaveAgent"
            @before-enter="enterAgent"
          >
            <button
              v-for="agent in filteredAgents"
              :id="`site-agent-${agent.id}`"
              :key="agent.id"
              type="button"
              role="tab"
              class="site-agent-logo-button"
              :aria-label="agent.id === 'other' ? 'Other agents' : agent.name"
              :data-tooltip="agent.id === 'other' ? 'Other agents' : agent.name"
              :aria-selected="selectedAgentId === agent.id"
              aria-controls="site-agent-configuration"
              :tabindex="focusableAgentId === agent.id ? 0 : -1"
              @click="selectedAgentId = agent.id"
              @keydown.left.prevent="selectAdjacentAgent(-1, agent.id)"
              @keydown.right.prevent="selectAdjacentAgent(1, agent.id)"
            >
              <Ellipsis
                v-if="agent.id === 'other'"
                class="site-agent-more-icon"
                aria-hidden="true"
              />
              <BrandIcon v-else :client-id="agent.id" :monochrome="selectedAgentId !== agent.id" />
            </button>
          </TransitionGroup>
          <p v-if="!filteredAgents.length" class="site-agent-search-empty" role="status">
            No agents found. Try another name.
          </p>
        </div>
        <p v-if="searchQuery && filteredAgents.length" class="site-sr-only" role="status">
          {{ filteredAgents.length }} {{ filteredAgents.length === 1 ? 'agent' : 'agents' }} found.
        </p>
        <div class="site-agent-meta">
          <p class="site-connect-requirement">Node.js 22.x, 24.x, or 26+ required.</p>
          <a
            v-if="selectedAgent.docsUrl"
            class="site-text-link site-agent-docs"
            :href="selectedAgent.docsUrl"
            :aria-label="`${selectedAgent.name} setup documentation`"
            target="_blank"
            rel="noopener noreferrer"
          >
            Setup docs <ArrowUpRight aria-hidden="true" />
          </a>
        </div>
        <span id="site-agent-selection" class="site-sr-only">{{ selectedAgent.name }}</span>
        <div
          id="site-agent-configuration"
          class="site-setup-options"
          role="tabpanel"
          :aria-labelledby="
            filteredAgents.includes(selectedAgent)
              ? `site-agent-${selectedAgentId}`
              : 'site-agent-selection'
          "
          tabindex="0"
        >
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
                  <p class="site-connect-row-copy site-setup-hint">
                    <template
                      v-for="(part, partIndex) in getCopyHint(action, actionIndex).split(
                        /`([^`]+)`/g
                      )"
                      :key="partIndex"
                      ><code v-if="partIndex % 2">{{ part }}</code
                      ><template v-else>{{ part }}</template></template
                    >
                  </p>
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
            Prefer to configure it yourself?
            <button type="button" class="site-text-link" @click="selectManualSetup">
              Manual setup <ArrowUpRight aria-hidden="true" />
            </button>
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
