<script lang="ts" setup>
import { shallowRef, watchEffect } from 'vue'
import {
  selection,
  selectedNode,
  options,
  selectedTemPadComponent
} from '@/entrypoints/ui/state'
import { serializeCSS } from '@/entrypoints/ui/utils'
import Section from '../Section.vue'
import Code from '../Code.vue'
import IconButton from '../IconButton.vue'
import Preview from '../icons/Preview.vue'

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const css = shallowRef('')
const js = shallowRef('')

watchEffect(async () => {
  const node = selectedNode.value

  if (node == null || selection.value.length > 1) {
    css.value = ''
    return
  }

  const component = selectedTemPadComponent.value
  componentCode.value = component?.code || ''
  componentLink.value = component?.link || ''

  const { cssUnit, rootFontSize } = options.value
  const serializeOptions = {
    useRem: cssUnit === 'rem',
    rootFontSize
  }

  const style = await node.getCSSAsync()
  css.value = serializeCSS(style, serializeOptions)
  js.value = serializeCSS(style, { toJS: true, ...serializeOptions })
})

function open() {
  window.open(componentLink.value)
}
</script>

<template>
  <Section title="Code" :collapsed="!selectedNode || !(componentCode || css)">
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
          v-if="componentLink"
          variant="secondary"
          title="Open in TemPad Playground"
          @click="open"
        >
          <Preview />
        </IconButton>
      </template>
    </Code>
    <Code v-if="css" class="tp-code-code" title="CSS" lang="css" :code="css" />
    <Code v-if="css" class="tp-code-code" title="JavaScript" lang="js" :code="js" />
  </Section>
</template>

<style scoped>
.tp-code-code {
  margin-bottom: 8px;
}
</style>
@/entrypoints/ui/utils/utils
