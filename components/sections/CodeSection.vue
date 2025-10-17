<script setup lang="ts">
import type { CodeBlock } from '@/types/codegen'

import Badge from '@/components/Badge.vue'
import Code from '@/components/Code.vue'
import IconButton from '@/components/IconButton.vue'
import Info from '@/components/icons/Info.vue'
import Preview from '@/components/icons/Preview.vue'
import Section from '@/components/Section.vue'
import { selection, selectedNode, options, selectedTemPadComponent, activePlugin } from '@/ui/state'
import { getDesignComponent } from '@/utils'

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const codeBlocks = shallowRef<CodeBlock[]>([])
const warning = shallowRef('')

const playButtonTitle = computed(() =>
  componentLink.value
    ? 'Open in TemPad Playground'
    : 'The component is produced with older versions of TemPad that does not provide a link to TemPad playground.'
)

async function updateCode() {
  const node = selectedNode.value

  if (node == null || selection.value.length > 1) {
    codeBlocks.value = []
    return
  }

  const tempadComponent = selectedTemPadComponent.value
  componentCode.value = tempadComponent?.code || ''
  componentLink.value = tempadComponent?.link || ''

  const component = getDesignComponent(node)

  const style = await node.getCSSAsync()
  const { cssUnit, rootFontSize, scale } = options.value
  const serializeOptions = {
    useRem: cssUnit === 'rem',
    rootFontSize,
    scale
  }

  codeBlocks.value = (
    await codegen(style, component, serializeOptions, activePlugin.value?.code || undefined)
  ).codeBlocks

  if ('warning' in node) {
    warning.value = node.warning
  } else {
    warning.value = ''
  }
}

watch(options, updateCode, {
  deep: true
})

watch([selectedNode, activePlugin], updateCode)

function open() {
  window.open(componentLink.value)
}
</script>

<template>
  <Section :collapsed="!selectedNode || !(componentCode || codeBlocks.length)">
    <template #header>
      <div class="tp-code-header tp-row tp-shrink tp-gap-l">
        Code
        <Badge v-if="activePlugin" title="Code in this section is transformed by this plugin">{{
          activePlugin.name
        }}</Badge>
      </div>
      <IconButton v-if="warning" variant="secondary" :title="warning" dull>
        <Info />
      </IconButton>
    </template>
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
  </Section>
</template>

<style scoped>
[data-fpl-version='ui2'] .tp-code-header {
  gap: var(--spacer-l, 8px);
}

.tp-code-code {
  margin-bottom: 8px;
}
</style>
