<script setup lang="ts">
import type { McpClientConfig, McpClientCopyPayload } from '@tempad-dev/shared'

import {
  getMcpClientCopyPayload,
  getNextMcpClientCopyVariant,
  MCP_CLIENTS_BY_ID,
  MCP_SKILL_INSTALL_COMMAND
} from '@tempad-dev/shared'
import { Copy, FileText, SquareTerminal } from 'lucide-vue-next'
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
import { CONNECT_CLIENT_ORDER } from '@/content/landing'

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

const clients = CONNECT_CLIENT_ORDER.map((id) => MCP_CLIENTS_BY_ID[id])
const SkillPreviewDialog = defineAsyncComponent(() => import('@/components/SkillPreviewDialog.vue'))

const feedback = ref<{ kind: FeedbackKind; text: string } | null>(null)
const isSkillPreviewOpen = ref(false)
const hasLoadedSkillPreview = ref(false)
const activeTerminalEntryIndex = ref(0)
const activeTerminalCharCount = ref(0)
const terminalCardRef = ref<HTMLElement | null>(null)
const terminalViewportRef = ref<HTMLElement | null>(null)
const nextCopyVariantByClient = ref<
  Partial<Record<McpClientConfig['id'], 'primary' | 'alternate'>>
>({})

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

function openDeepLink(client: McpClientConfig): void {
  if (!client.deepLink) return

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

    if (client.fallbackDeepLink) {
      window.location.href = client.fallbackDeepLink
      showFeedback(`Trying the fallback install link for ${client.name}…`, 'info')
      return
    }

    showFeedback(`No response from ${client.name}. Install it first, then try again.`, 'info')
  }, 850)

  window.addEventListener('blur', cleanup, { once: true })
  window.addEventListener('pagehide', cleanup, { once: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)

  window.location.href = client.deepLink
}

function getCopyPayload(client: McpClientConfig): McpClientCopyPayload | null {
  return getMcpClientCopyPayload(client, nextCopyVariantByClient.value[client.id] ?? 'primary')
}

function getNextCopyPayload(client: McpClientConfig): McpClientCopyPayload | null {
  const currentVariant = nextCopyVariantByClient.value[client.id] ?? 'primary'
  return getMcpClientCopyPayload(client, getNextMcpClientCopyVariant(client, currentVariant))
}

function toggleCopyVariant(client: McpClientConfig): void {
  const currentVariant = nextCopyVariantByClient.value[client.id] ?? 'primary'
  nextCopyVariantByClient.value[client.id] = getNextMcpClientCopyVariant(client, currentVariant)
}

function getClientActionLabel(client: McpClientConfig): string {
  if (client.deepLink) {
    return 'Open'
  }

  const payload = getCopyPayload(client)
  if (payload?.kind === 'command') {
    return 'Copy command'
  }

  return 'Copy config'
}

function getClientCopySuccessMessage(client: McpClientConfig): string {
  const payload = getCopyPayload(client)
  if (!payload) {
    return 'Copied config snippet.'
  }

  const copied = payload.kind === 'command' ? 'Copied install command.' : 'Copied config snippet.'
  const nextPayload = getNextCopyPayload(client)
  if (!nextPayload || nextPayload.kind === payload.kind) {
    return copied
  }

  const nextLabel = nextPayload.kind === 'config' ? 'config' : 'command'
  return `${copied} Click again to copy ${nextLabel}.`
}

function handleClientAction(client: McpClientConfig): void {
  if (client.deepLink) {
    openDeepLink(client)
    return
  }

  const payload = getCopyPayload(client)
  if (payload) {
    void writeClipboard(payload.text, getClientCopySuccessMessage(client))
    toggleCopyVariant(client)
  }
}

function handleCopySkill(): void {
  void writeClipboard(MCP_SKILL_INSTALL_COMMAND, 'Copied skill install command.')
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
    title="Let it flow to code"
    copy="With the skill and MCP server in place, the same design context stays available from the request to the tool call."
  >
    <div class="site-connect-layout">
      <div class="site-connect-setup">
        <div class="site-connect-row">
          <div class="site-connect-row-head">
            <p class="site-connect-row-step">Step 1</p>
            <p class="site-connect-row-label">Add the skill</p>
            <p class="site-connect-row-copy">
              Install the TemPad skill so the agent can pick up the handoff workflow for the turn.
            </p>
          </div>
          <div class="site-connect-actions">
            <ActionButton
              type="button"
              variant="primary"
              class="site-connect-action-button"
              @click="handleCopySkill"
            >
              <Copy aria-hidden="true" />
              <span>Copy skill command</span>
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
            <p class="site-connect-row-label">Install the MCP server</p>
            <p class="site-connect-row-copy">
              Add TemPad to the client you already use so the same tools are available directly.
            </p>
          </div>
          <div class="site-client-quicklist">
            <button
              v-for="client in clients"
              :key="client.id"
              type="button"
              class="site-client-icon-button"
              :aria-label="`${client.name}: ${getClientActionLabel(client)}`"
              :title="`${client.name}: ${getClientActionLabel(client)}`"
              @click="handleClientAction(client)"
            >
              <BrandIcon :client-id="client.id" />
            </button>
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
