<script lang="ts" setup>
import { shallowRef, watchEffect } from 'vue'
import { selection, selectedNode, options, selectedTemPadComponent } from '@/entrypoints/ui/state'
import { serializeCSS } from '@/entrypoints/ui/utils'
import Section from '../Section.vue'
import Code from '../Code.vue'
import IconButton from '../IconButton.vue'
import Preview from '../icons/Preview.vue'
import { computed } from 'vue'
import Info from '../icons/Info.vue'

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const css = shallowRef('')
const js = shallowRef('')
const warning = shallowRef('')

const playButtonTitle = computed(() =>
  componentLink.value
    ? 'Open in TemPad Playground'
    : 'The component is produced with older versions of TemPad that does not provide a link to TemPad playground.'
)

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
  <Section title="Code" :collapsed="!selectedNode || !(componentCode || css)">
    <template #header>
      Code
      <IconButton
        v-if="warning"
        variant="secondary"
        :title="warning"
        dull
      >
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
    <Code v-if="css" class="tp-code-code" title="CSS" lang="css" :code="css" />
    <Code v-if="css" class="tp-code-code" title="JavaScript" lang="js" :code="js" />
  </Section>
</template>

<style scoped>
.tp-code-code {
  margin-bottom: 8px;
}
</style>
