<script setup lang="ts">
import type { RequestPayload, ResponsePayload, SerializeOptions } from '@/codegen/types'

import { CodeBlock } from '@/codegen/types'
import Code from '@/components/Code.vue'
import IconButton from '@/components/IconButton.vue'
import Info from '@/components/icons/Info.vue'
import Preview from '@/components/icons/Preview.vue'
import Section from '@/components/Section.vue'
import Codegen from '@/entrypoints/ui/codegen?worker&inline'
import { createWorkerRequester } from '@/entrypoints/ui/worker'
import {
  selection,
  selectedNode,
  options,
  selectedTemPadComponent,
  activePluginCode
} from '@/ui/state'

async function codegen(
  style: Record<string, string>,
  options: SerializeOptions,
  pluginCode?: string
): Promise<CodeBlock[]> {
  const request = createWorkerRequester<RequestPayload, ResponsePayload>(Codegen)

  try {
    const result = await request({
      style,
      options,
      pluginCode
    })

    return result.codeBlocks
  } catch (error) {
    console.error(error)
    return []
  }
}

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const codeBlocks = shallowRef<CodeBlock[]>([])
const warning = shallowRef('')

const playButtonTitle = computed(() =>
  componentLink.value
    ? 'Open in TemPad Playground'
    : 'The component is produced with older versions of TemPad that does not provide a link to TemPad playground.'
)

watch([selectedNode, options, activePluginCode], async () => {
  const node = selectedNode.value

  if (node == null || selection.value.length > 1) {
    codeBlocks.value = []
    return
  }

  const component = selectedTemPadComponent.value
  componentCode.value = component?.code || ''
  componentLink.value = component?.link || ''

  const style = await node.getCSSAsync()
  const { cssUnit, rootFontSize } = options.value
  const serializeOptions = {
    useRem: cssUnit === 'rem',
    rootFontSize
  }

  codeBlocks.value = await codegen(style, serializeOptions, activePluginCode.value || undefined)

  if ('warning' in node) {
    warning.value = node.warning
  } else {
    warning.value = ''
  }
})

function open() {
  window.open(componentLink.value)
}
</script>

<template>
  <Section :collapsed="!selectedNode || !(componentCode || codeBlocks.length)">
    <template #header>
      Code
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
.tp-code-code {
  margin-bottom: 8px;
}
</style>
