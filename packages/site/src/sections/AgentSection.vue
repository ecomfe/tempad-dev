<script setup lang="ts">
import {
  Blocks,
  Check,
  Code2,
  Copy,
  PanelsTopLeft,
  PencilRuler,
  ScanEye,
  ScanSearch,
  SwatchBook
} from 'lucide-vue-next'
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'

import type { SiteSkill } from '@/content/landing'

import SectionShell from '@/components/SectionShell.vue'

const emit = defineEmits<{ 'open-skill': [skill: SiteSkill] }>()
const scenarios = [
  {
    id: 'canvas' as const,
    label: 'Create in Figma',
    prompt:
      'Create a settings screen in this Figma file. Reuse its existing components and variables.',
    steps: [
      {
        icon: SwatchBook,
        title: 'Read the design system',
        body: 'Find reusable components, variables, and styles in the file.'
      },
      {
        icon: PencilRuler,
        title: 'Compose native layers',
        body: 'Build the screen with the file’s components and design tokens.'
      },
      {
        icon: ScanEye,
        title: 'Refine the design',
        body: 'Review spacing, hierarchy, and visual details in Figma.'
      }
    ],
    note: 'Requires edit access to a Figma Design file.',
    guide: 'Read the canvas skill'
  },
  {
    id: 'code' as const,
    label: 'Build in your project',
    prompt:
      'Implement the selected Figma frame using this project’s components and styling conventions.',
    steps: [
      {
        icon: ScanSearch,
        title: 'Inspect the selection',
        body: 'Read layout, styles, variables, and assets from the selected frame.'
      },
      {
        icon: Blocks,
        title: 'Match project conventions',
        body: 'Reuse existing components and styling patterns in your codebase.'
      },
      {
        icon: Code2,
        title: 'Implement and validate',
        body: 'Build the interface and run the project’s checks.'
      }
    ],
    note: '',
    guide: 'Read the design-to-code skill'
  }
]
const selectedId = ref<SiteSkill>('canvas')
const scenario = computed(() => scenarios.find(({ id }) => id === selectedId.value)!)
const copyStatus = ref('')
let copyTimer: number | undefined

async function copyPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(scenario.value.prompt)
    copyStatus.value = 'Copied'
  } catch {
    copyStatus.value = 'Select the text to copy it.'
  }
  window.clearTimeout(copyTimer)
  copyTimer = window.setTimeout(() => {
    copyStatus.value = ''
  }, 2400)
}

function selectScenario(id: SiteSkill): void {
  selectedId.value = id
  copyStatus.value = ''
}

function selectAdjacentScenario(): void {
  selectScenario(selectedId.value === 'canvas' ? 'code' : 'canvas')
  void nextTick(() => document.getElementById(`site-scenario-${selectedId.value}`)?.focus())
}

onBeforeUnmount(() => window.clearTimeout(copyTimer))
</script>

<template>
  <SectionShell id="agents" title="With your coding agent">
    <div class="site-scenario">
      <div
        class="site-scenario-tabs"
        :data-active="selectedId"
        role="tablist"
        aria-label="Agent workflow"
      >
        <button
          v-for="item in scenarios"
          :id="`site-scenario-${item.id}`"
          :key="item.id"
          type="button"
          role="tab"
          :aria-selected="selectedId === item.id"
          aria-controls="site-scenario-panel"
          :tabindex="selectedId === item.id ? 0 : -1"
          @click="selectScenario(item.id)"
          @keydown.left.prevent="selectAdjacentScenario"
          @keydown.right.prevent="selectAdjacentScenario"
        >
          <component :is="item.id === 'canvas' ? PanelsTopLeft : Code2" aria-hidden="true" />
          {{ item.label }}
        </button>
      </div>
      <div
        id="site-scenario-panel"
        class="site-scenario-panel"
        role="tabpanel"
        :aria-labelledby="`site-scenario-${selectedId}`"
        tabindex="0"
      >
        <div class="site-scenario-request">
          <p class="site-scenario-label">Example request</p>
          <blockquote>
            <span>{{ scenario.prompt }}</span>
            <button
              type="button"
              class="site-prompt-copy"
              :aria-label="copyStatus === 'Copied' ? 'Request copied' : 'Copy request'"
              :title="copyStatus === 'Copied' ? 'Copied' : 'Copy request'"
              @click="copyPrompt"
            >
              <Check v-if="copyStatus === 'Copied'" aria-hidden="true" />
              <Copy v-else aria-hidden="true" />
            </button>
          </blockquote>
          <span class="site-sr-only" role="status">{{ copyStatus }}</span>
          <div class="site-scenario-actions">
            <button type="button" class="site-text-link" @click="emit('open-skill', selectedId)">
              {{ scenario.guide }} →
            </button>
          </div>
          <p v-if="scenario.note" class="site-scenario-note">{{ scenario.note }}</p>
        </div>
        <ol class="site-scenario-steps site-detail-list">
          <li v-for="step in scenario.steps" :key="step.title" class="site-detail-item">
            <div class="site-detail-icon" aria-hidden="true"><component :is="step.icon" /></div>
            <div class="site-detail-copy">
              <h3 class="site-detail-title">{{ step.title }}</h3>
              <p class="site-detail-body">{{ step.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </SectionShell>
</template>
