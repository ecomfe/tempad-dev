<script setup lang="ts">
import type {
  AgentIntegrationAction,
  AgentIntegrationConfig,
  AgentIntegrationId
} from '@tempad-dev/shared'

import { AGENT_INTEGRATIONS } from '@tempad-dev/shared'
import { Copy, ExternalLink, FileText, SquareTerminal } from 'lucide-vue-next'
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'

import ActionButton from '@/components/ActionButton.vue'
import BrandIcon from '@/components/BrandIcon.vue'
import SectionShell from '@/components/SectionShell.vue'
import { SITE_LINKS } from '@/content/landing'

type FeedbackKind = 'success' | 'info' | 'error'

type TerminalSegment = {
  kind: 'text' | 'label' | 'code' | 'code-secondary' | 'diff-add' | 'diff-del'
  text: string
}

type TerminalLineKind = 'prompt' | 'body' | 'sub' | 'mcp' | 'agent'

type TerminalEntry =
  | { kind: 'divider' }
  | { kind: TerminalLineKind; segments: readonly TerminalSegment[] }

type TerminalContentEntry = Exclude<TerminalEntry, { kind: 'divider' }>

type RenderedTerminalEntry =
  | { kind: 'divider' }
  | {
      kind: TerminalLineKind
      cursor: boolean
      segments: readonly TerminalSegment[]
    }

const agents = AGENT_INTEGRATIONS
const SkillPreviewDialog = defineAsyncComponent(() => import('@/components/SkillPreviewDialog.vue'))

const feedback = ref<{ kind: FeedbackKind; text: string } | null>(null)
const isSkillPreviewOpen = ref(false)
const hasLoadedSkillPreview = ref(false)
const activeTerminalEntryIndex = ref(0)
const activeTerminalCharCount = ref(0)
const selectedAgentId = ref<AgentIntegrationId>('codex')
const terminalCardRef = ref<HTMLElement | null>(null)
const terminalViewportRef = ref<HTMLElement | null>(null)
const selectedAgent = computed(() => agents.find(({ id }) => id === selectedAgentId.value)!)
const selectedAgentDescription = computed(() =>
  selectedAgent.value.actions.some(({ id }) => id === 'plugin-prompt')
    ? 'Install the plugin to add MCP access and the design skill together.'
    : 'Connect the MCP server, then add the design skill.'
)

const terminalEntries: readonly TerminalEntry[] = [
  {
    kind: 'prompt',
    segments: [{ kind: 'text', text: '› Implement the Figma selection with HTML/CSS' }]
  },
  {
    kind: 'body',
    segments: [
      { kind: 'text', text: '• Using the ' },
      { kind: 'code', text: 'figma-design-to-code' },
      {
        kind: 'text',
        text: ' skill for this turn. I’m reading the repo and the skill instructions first so I can map the selected Figma node into the existing codebase instead of generating disconnected markup.'
      }
    ]
  },
  {
    kind: 'body',
    segments: [
      { kind: 'text', text: '• ' },
      { kind: 'label', text: 'Explored' }
    ]
  },
  {
    kind: 'sub',
    segments: [
      { kind: 'text', text: '└ ' },
      { kind: 'code', text: 'Read' },
      { kind: 'text', text: ' SKILL.md' }
    ]
  },
  { kind: 'divider' },
  {
    kind: 'body',
    segments: [
      { kind: 'text', text: '• ' },
      { kind: 'label', text: 'Explored' }
    ]
  },
  {
    kind: 'sub',
    segments: [
      { kind: 'text', text: '└ ' },
      { kind: 'code', text: 'Read' },
      { kind: 'text', text: ' index.html, styles.css' }
    ]
  },
  { kind: 'divider' },
  {
    kind: 'mcp',
    segments: [
      { kind: 'text', text: '• ' },
      { kind: 'label', text: 'Called' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'tempad-dev.get_code' },
      { kind: 'text', text: '(' },
      { kind: 'code-secondary', text: '{"preferredLang":"jsx","resolveTokens":false}' },
      { kind: 'text', text: ')' }
    ]
  },
  {
    kind: 'sub',
    segments: [
      { kind: 'text', text: '└ Generated ' },
      { kind: 'code', text: 'jsx' },
      { kind: 'text', text: ' snippet (1.7 kB). No binary assets were attached to this response.' }
    ]
  },
  { kind: 'divider' },
  {
    kind: 'agent',
    segments: [
      {
        kind: 'text',
        text: '• I have the TemPad output now. I’m translating it into the host HTML/CSS structure without inventing styles outside the design evidence.'
      }
    ]
  },
  { kind: 'divider' },
  {
    kind: 'body',
    segments: [
      { kind: 'text', text: '• ' },
      { kind: 'label', text: 'Edited' },
      { kind: 'text', text: ' index.html (' },
      { kind: 'diff-add', text: '+6' },
      { kind: 'text', text: ' ' },
      { kind: 'diff-del', text: '-0' },
      { kind: 'text', text: ')' }
    ]
  },
  {
    kind: 'body',
    segments: [
      { kind: 'text', text: '• ' },
      { kind: 'label', text: 'Edited' },
      { kind: 'text', text: ' styles.css (' },
      { kind: 'diff-add', text: '+18' },
      { kind: 'text', text: ' ' },
      { kind: 'diff-del', text: '-4' },
      { kind: 'text', text: ')' }
    ]
  }
] as const

const renderedTerminalEntries = computed<readonly RenderedTerminalEntry[]>(() => {
  const entries: RenderedTerminalEntry[] = []

  for (const [index, entry] of terminalEntries.entries()) {
    if (index > activeTerminalEntryIndex.value) {
      break
    }

    if (entry.kind === 'divider') {
      entries.push({ kind: 'divider' })
      continue
    }

    entries.push({
      kind: entry.kind,
      cursor: index === activeTerminalEntryIndex.value,
      segments: getRenderedSegments(entry, index)
    })
  }

  return entries
})

let feedbackTimer: number | undefined
let terminalTimer: number | undefined
let terminalObserver: IntersectionObserver | undefined
let terminalRestartPending = false

function setTerminalIdleState(): void {
  activeTerminalEntryIndex.value = 0
  activeTerminalCharCount.value = 1
}

function getRenderedSegments(
  entry: TerminalContentEntry,
  index: number
): readonly TerminalSegment[] {
  if (index !== activeTerminalEntryIndex.value) {
    return entry.segments
  }

  return sliceSegments(entry.segments, activeTerminalCharCount.value)
}

function getEntryLength(entry: TerminalContentEntry): number {
  return entry.segments.reduce((sum, segment) => sum + segment.text.length, 0)
}

function getEntryText(entry: TerminalContentEntry): string {
  return entry.segments.map((segment) => segment.text).join('')
}

function getPreferredChunkSize(kind: TerminalLineKind): number {
  switch (kind) {
    case 'prompt':
      return 14 + Math.floor(Math.random() * 12)
    case 'mcp':
      return 18 + Math.floor(Math.random() * 14)
    case 'sub':
      return 16 + Math.floor(Math.random() * 12)
    default:
      return 22 + Math.floor(Math.random() * 18)
  }
}

function getNextChunkCharCount(entry: TerminalContentEntry, currentCount: number): number {
  const fullText = getEntryText(entry)

  if (currentCount >= fullText.length) {
    return currentCount
  }

  const preferredChunkSize = getPreferredChunkSize(entry.kind)
  const target = Math.min(currentCount + preferredChunkSize, fullText.length)

  if (target === fullText.length) {
    return target
  }

  const boundary = fullText.slice(target).search(/[ .,;:)}\]]/)

  if (boundary < 0) {
    return fullText.length
  }

  return Math.min(target + boundary + 1, fullText.length)
}

function sliceSegments(
  segments: readonly TerminalSegment[],
  visibleChars: number
): readonly TerminalSegment[] {
  let remainingChars = visibleChars

  return segments.flatMap((segment) => {
    if (remainingChars <= 0) {
      return []
    }

    const text = segment.text.slice(0, remainingChars)
    remainingChars -= text.length

    if (!text) {
      return []
    }

    return [{ kind: segment.kind, text }]
  })
}

function showFeedback(text: string, kind: FeedbackKind = 'success'): void {
  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }

  feedback.value = { kind, text }
  feedbackTimer = window.setTimeout(() => {
    feedback.value = null
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

function getActionLabel(action: AgentIntegrationAction, agent: AgentIntegrationConfig): string {
  switch (action.id) {
    case 'plugin-prompt':
      return `Continue in ${agent.name}`
    case 'plugin-cli':
      return 'Copy plugin command'
    case 'mcp-deep-link':
      return 'Install MCP server'
    case 'mcp-cli':
      return 'Copy MCP command'
    case 'mcp-config':
      return 'Copy MCP config'
    case 'skill-cli':
      return 'Copy skill command'
  }
}

function handleAgentAction(action: AgentIntegrationAction): void {
  if (action.kind === 'deep-link') {
    openDeepLink(action, selectedAgent.value)
    return
  }

  const message = action.kind === 'config' ? 'Copied MCP config.' : 'Copied setup command.'
  void writeClipboard(action.value, message)
}

function selectAdjacentAgent(direction: -1 | 1): void {
  const index = agents.findIndex(({ id }) => id === selectedAgentId.value)
  const nextIndex = (index + direction + agents.length) % agents.length
  selectedAgentId.value = agents[nextIndex]?.id ?? 'codex'

  nextTick(() =>
    document.querySelector<HTMLElement>(`#site-agent-tab-${selectedAgentId.value}`)?.focus()
  )
}

function handleOpenSkillPreview(): void {
  hasLoadedSkillPreview.value = true
  isSkillPreviewOpen.value = true
}

function scheduleTerminalAdvance(delay: number): void {
  terminalTimer = window.setTimeout(advanceTerminalAnimation, delay)
}

function clearTerminalTimer(): void {
  if (terminalTimer) {
    window.clearTimeout(terminalTimer)
    terminalTimer = undefined
  }
}

function getRandomDelay(min: number, max: number): number {
  return Math.round(min + Math.random() * (max - min))
}

function advanceTerminalAnimation(): void {
  if (terminalRestartPending) {
    terminalRestartPending = false
    setTerminalIdleState()
    scheduleTerminalAdvance(getRandomDelay(700, 1100))
    return
  }

  const currentEntry = terminalEntries[activeTerminalEntryIndex.value]

  if (!currentEntry) {
    terminalTimer = undefined
    return
  }

  if (currentEntry.kind === 'divider') {
    activeTerminalEntryIndex.value += 1
    activeTerminalCharCount.value = 0
    scheduleTerminalAdvance(getRandomDelay(220, 360))
    return
  }

  const entryLength = getEntryLength(currentEntry)

  if (activeTerminalCharCount.value < entryLength) {
    activeTerminalCharCount.value = getNextChunkCharCount(
      currentEntry,
      activeTerminalCharCount.value
    )
    scheduleTerminalAdvance(
      currentEntry.kind === 'prompt' ? getRandomDelay(80, 160) : getRandomDelay(100, 220)
    )
    return
  }

  if (activeTerminalEntryIndex.value >= terminalEntries.length - 1) {
    terminalRestartPending = true
    scheduleTerminalAdvance(getRandomDelay(5000, 5600))
    return
  }

  activeTerminalEntryIndex.value += 1
  activeTerminalCharCount.value = 0
  scheduleTerminalAdvance(getRandomDelay(260, 520))
}

function startTerminalAnimation(): void {
  clearTerminalTimer()
  terminalRestartPending = false

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) {
    activeTerminalEntryIndex.value = terminalEntries.length - 1
    const lastEntry = terminalEntries[terminalEntries.length - 1]

    if (!lastEntry || lastEntry.kind === 'divider') {
      activeTerminalCharCount.value = 0
      return
    }

    activeTerminalCharCount.value = getEntryLength(lastEntry)
    return
  }

  setTerminalIdleState()
  scheduleTerminalAdvance(getRandomDelay(700, 1100))
}

watch([activeTerminalEntryIndex, activeTerminalCharCount], async () => {
  await nextTick()

  const viewport = terminalViewportRef.value

  if (!viewport) {
    return
  }

  viewport.scrollTop = viewport.scrollHeight
})

onMounted(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (reducedMotion) {
    startTerminalAnimation()
    return
  }

  const target = terminalCardRef.value

  if (!target || typeof IntersectionObserver === 'undefined') {
    startTerminalAnimation()
    return
  }

  terminalObserver = new IntersectionObserver(
    (entries) => {
      const [entry] = entries

      if (!entry?.isIntersecting) {
        return
      }

      startTerminalAnimation()
      terminalObserver?.disconnect()
      terminalObserver = undefined
    },
    {
      threshold: 0.45
    }
  )

  terminalObserver.observe(target)
})

onBeforeUnmount(() => {
  if (feedbackTimer) {
    window.clearTimeout(feedbackTimer)
  }

  if (terminalObserver) {
    terminalObserver.disconnect()
  }

  clearTerminalTimer()
})
</script>

<template>
  <SectionShell
    id="connect"
    eyebrow="Connect"
    title="Stream it to code"
    copy="TemPad Dev pairs an agent skill with the MCP server so agents can keep the selected Figma node in view while they edit code."
  >
    <div class="site-connect-layout">
      <div class="site-connect-setup">
        <div class="site-connect-row">
          <div class="site-connect-row-head">
            <p class="site-connect-row-step">Step 1</p>
            <p class="site-connect-row-label">Open TemPad Dev in Figma</p>
            <p class="site-connect-row-copy">
              Enable MCP access under Preferences → Agent integration, then keep the panel open in
              the file you want the agent to inspect.
            </p>
          </div>
          <div class="site-connect-actions">
            <ActionButton
              :href="SITE_LINKS.install"
              external
              variant="primary"
              class="site-connect-action-button"
            >
              <ExternalLink aria-hidden="true" />
              <span>Install extension</span>
            </ActionButton>
            <ActionButton
              type="button"
              variant="secondary"
              class="site-connect-action-button"
              @click="handleOpenSkillPreview"
            >
              <FileText aria-hidden="true" />
              <span>View skill</span>
            </ActionButton>
          </div>
        </div>

        <div class="site-connect-row">
          <div class="site-connect-row-head">
            <p class="site-connect-row-step">Step 2</p>
            <p class="site-connect-row-label">Set up your agent</p>
            <p class="site-connect-row-copy">
              Choose a supported agent to use its shortest available setup path.
            </p>
          </div>
          <div class="site-client-quicklist" role="tablist" aria-label="Agent">
            <button
              v-for="agent in agents"
              :id="`site-agent-tab-${agent.id}`"
              :key="agent.id"
              type="button"
              role="tab"
              class="site-client-icon-button"
              :aria-label="agent.name"
              :aria-selected="selectedAgentId === agent.id"
              aria-controls="site-connect-agent-panel"
              :tabindex="selectedAgentId === agent.id ? 0 : -1"
              :title="agent.name"
              @click="selectedAgentId = agent.id"
              @keydown.left.prevent="selectAdjacentAgent(-1)"
              @keydown.up.prevent="selectAdjacentAgent(-1)"
              @keydown.right.prevent="selectAdjacentAgent(1)"
              @keydown.down.prevent="selectAdjacentAgent(1)"
            >
              <BrandIcon :client-id="agent.id" />
            </button>
          </div>
          <div
            id="site-connect-agent-panel"
            class="site-connect-agent-panel"
            role="tabpanel"
            :aria-labelledby="`site-agent-tab-${selectedAgent.id}`"
          >
            <div class="site-connect-agent-copy">
              <p class="site-connect-agent-name">{{ selectedAgent.name }}</p>
              <p>{{ selectedAgentDescription }}</p>
            </div>
            <div class="site-connect-actions">
              <ActionButton
                v-for="(action, index) in selectedAgent.actions"
                :key="action.id"
                type="button"
                :variant="index === 0 ? 'primary' : 'secondary'"
                class="site-connect-action-button"
                @click="handleAgentAction(action)"
              >
                <ExternalLink v-if="action.kind === 'deep-link'" aria-hidden="true" />
                <Copy v-else aria-hidden="true" />
                <span>{{ getActionLabel(action, selectedAgent) }}</span>
              </ActionButton>
            </div>
          </div>
        </div>
      </div>

      <article ref="terminalCardRef" class="site-agent-card">
        <div class="site-agent-card-head">
          <span class="site-agent-card-title">
            <SquareTerminal aria-hidden="true" />
            <span>Terminal</span>
          </span>
          <span class="site-agent-card-note">example turn</span>
        </div>

        <div ref="terminalViewportRef" class="site-terminal">
          <template
            v-for="(entry, index) in renderedTerminalEntries"
            :key="`${entry.kind}-${index}`"
          >
            <div v-if="entry.kind === 'divider'" class="site-terminal-divider" />
            <p
              v-else
              class="site-terminal-line"
              :class="`is-${entry.kind}`"
              :data-cursor="entry.cursor ? 'true' : undefined"
            >
              <template v-for="(segment, segmentIndex) in entry.segments" :key="segmentIndex">
                <strong v-if="segment.kind === 'label'" class="site-terminal-label">
                  {{ segment.text }}
                </strong>
                <code
                  v-else-if="
                    segment.kind === 'code' ||
                    segment.kind === 'code-secondary' ||
                    segment.kind === 'diff-add' ||
                    segment.kind === 'diff-del'
                  "
                  :class="{
                    'is-secondary': segment.kind === 'code-secondary',
                    'is-diff-add': segment.kind === 'diff-add',
                    'is-diff-del': segment.kind === 'diff-del'
                  }"
                >
                  {{ segment.text }}
                </code>
                <template v-else>{{ segment.text }}</template>
              </template>
            </p>
          </template>
        </div>
      </article>
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

    <SkillPreviewDialog
      v-if="hasLoadedSkillPreview"
      :open="isSkillPreviewOpen"
      @close="isSkillPreviewOpen = false"
    />
  </SectionShell>
</template>
