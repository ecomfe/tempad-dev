<script setup lang="ts">
import type { McpClientConfig } from '@tempad-dev/shared'

import { MCP_CLIENTS_BY_ID, MCP_SKILL_INSTALL_COMMAND } from '@tempad-dev/shared'
import { Copy, SquareTerminal } from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

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

type RenderedTerminalEntry =
  | { kind: 'divider' }
  | {
      kind: TerminalLineKind
      cursor: boolean
      segments: readonly TerminalSegment[]
    }

const clients = CONNECT_CLIENT_ORDER.map((id) => MCP_CLIENTS_BY_ID[id])

const feedback = ref<{ kind: FeedbackKind; text: string } | null>(null)
const activeTerminalEntryIndex = ref(0)
const activeTerminalCharCount = ref(0)
const terminalCardRef = ref<HTMLElement | null>(null)
const terminalViewportRef = ref<HTMLElement | null>(null)

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
      segments:
        index === activeTerminalEntryIndex.value
          ? sliceSegments(entry.segments, activeTerminalCharCount.value)
          : entry.segments
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

function getEntryLength(entry: Exclude<TerminalEntry, { kind: 'divider' }>): number {
  return entry.segments.reduce((sum, segment) => sum + segment.text.length, 0)
}

function getEntryText(entry: Exclude<TerminalEntry, { kind: 'divider' }>): string {
  return entry.segments.map((segment) => segment.text).join('')
}

function getNextChunkCharCount(
  entry: Exclude<TerminalEntry, { kind: 'divider' }>,
  currentCount: number
): number {
  const fullText = getEntryText(entry)

  if (currentCount >= fullText.length) {
    return currentCount
  }

  const preferredChunkSize =
    entry.kind === 'prompt'
      ? 14 + Math.floor(Math.random() * 12)
      : entry.kind === 'mcp'
        ? 18 + Math.floor(Math.random() * 14)
        : entry.kind === 'sub'
          ? 16 + Math.floor(Math.random() * 12)
          : 22 + Math.floor(Math.random() * 18)

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

function getClientActionLabel(client: McpClientConfig): string {
  if (client.deepLink) return 'Open'
  if (client.copyKind === 'command') return 'Copy command'
  return 'Copy config'
}

function handleClientAction(client: McpClientConfig): void {
  if (client.deepLink) {
    openDeepLink(client)
    return
  }

  if (client.copyText) {
    const label =
      client.copyKind === 'command' ? 'Copied install command.' : 'Copied config snippet.'
    void writeClipboard(client.copyText, label)
  }
}

function handleCopySkill(): void {
  void writeClipboard(MCP_SKILL_INSTALL_COMMAND, 'Copied skill install command.')
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
    activeTerminalCharCount.value =
      lastEntry && lastEntry.kind !== 'divider' ? getEntryLength(lastEntry) : 0
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
    copy="With the skill and MCP server in place, the same design context can stay available from the turn to the tool call."
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
          <button type="button" class="site-command-button" @click="handleCopySkill">
            <Copy aria-hidden="true" />
            <span>Copy skill command</span>
          </button>
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
              <BrandIcon :id="client.id" />
            </button>
          </div>
        </div>

        <p v-if="feedback" class="site-feedback" :class="`is-${feedback.kind}`">
          {{ feedback.text }}
        </p>
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
  </SectionShell>
</template>
