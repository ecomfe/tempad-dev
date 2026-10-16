<script setup lang="ts">
import { computed, shallowRef, watch, onBeforeUnmount } from 'vue'

import type { CodeBlock } from '@/types/codegen'

import Badge from '@/components/Badge.vue'
import Button from '@/components/Button.vue'
import Code from '@/components/Code.vue'
import IconButton from '@/components/IconButton.vue'
import Preview from '@/components/icons/Preview.vue'
import Section from '@/components/Section.vue'
import { selection, selectedNode, options, selectedTemPadComponent, activePlugin } from '@/ui/state'
import { generateCodeBlocksForNode } from '@/utils/codegen'

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const codeBlocks = shallowRef<CodeBlock[]>([])
const codeError = shallowRef('')
const loading = shallowRef(false)
const showLoading = shallowRef(false)
const content = shallowRef<HTMLElement | null>(null)
const loadingHeight = shallowRef(0)
let generation = 0
let loadingTimer: ReturnType<typeof setTimeout> | undefined

const playButtonTitle = computed(() =>
  componentLink.value
    ? 'Open in TemPad Playground'
    : 'This component was produced with an older version of TemPad Dev that does not provide a Playground link.'
)

async function updateCode() {
  const current = ++generation
  const node = selectedNode.value
  clearTimeout(loadingTimer)
  showLoading.value = false
  loadingHeight.value = content.value?.getBoundingClientRect().height ?? 0
  loading.value = false
  codeBlocks.value = []
  componentCode.value = ''
  componentLink.value = ''
  codeError.value = ''

  if (node == null || selection.value.length > 1) return
  loading.value = true
  loadingTimer = setTimeout(() => (showLoading.value = true), 150)

  const tempadComponent = selectedTemPadComponent.value
  componentCode.value = tempadComponent?.code || ''
  componentLink.value = tempadComponent?.link || ''

  try {
    const result = await generateCodeBlocksForNode(
      node,
      {
        cssUnit: options.value.cssUnit,
        rootFontSize: options.value.rootFontSize,
        scale: options.value.scale
      },
      activePlugin.value?.code || undefined,
      { variableDisplay: options.value.variableDisplay }
    )
    if (current === generation) codeBlocks.value = result.codeBlocks
  } catch {
    if (current === generation) codeError.value = 'Code generation failed.'
  } finally {
    if (current === generation) {
      clearTimeout(loadingTimer)
      showLoading.value = false
      loading.value = false
    }
  }
}

watch(
  [
    selection,
    activePlugin,
    () => options.value.cssUnit,
    () => options.value.rootFontSize,
    () => options.value.scale,
    () => options.value.variableDisplay
  ],
  updateCode,
  { immediate: true }
)
onBeforeUnmount(() => {
  generation++
  clearTimeout(loadingTimer)
})

function open() {
  window.open(componentLink.value)
}
</script>

<template>
  <Section
    :collapsed="!selectedNode || !(loading || componentCode || codeBlocks.length || codeError)"
  >
    <template #header>
      <div class="tp-code-header tp-row tp-shrink tp-gap-l">
        Code
        <Badge v-if="activePlugin" title="Code in this section is transformed by this plugin">{{
          activePlugin.name
        }}</Badge>
      </div>
    </template>
    <div
      ref="content"
      class="tp-code-content"
      :style="loading ? { minHeight: `${loadingHeight}px` } : undefined"
    >
      <p class="tp-code-status" role="status">{{ showLoading ? 'Generating code…' : '' }}</p>
      <div :aria-busy="loading">
        <p v-if="codeError" role="alert">
          {{ codeError }} <Button class="tp-code-retry" @click="updateCode">Retry</Button>
        </p>
        <Code
          v-if="componentCode"
          class="tp-code-code"
          title="Component"
          lang="js"
          :link="componentLink"
          :code="componentCode"
        >
          <template #actions>
            <IconButton
              :disabled="!componentLink"
              variant="secondary"
              :title="playButtonTitle"
              @click="open"
            >
              <Preview />
            </IconButton>
          </template>
        </Code>
        <Code
          v-for="{ name, title, lang, code } in codeBlocks"
          :key="name"
          class="tp-code-code"
          :title="title"
          :lang="lang"
          :code="code"
        />
      </div>
    </div>
  </Section>
</template>

<style scoped>
.tp-code-status:empty {
  margin: 0;
}
.tp-code-code {
  margin-bottom: 8px;
}
</style>
