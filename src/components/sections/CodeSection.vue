<script lang="ts" setup>
import { shallowRef, watchEffect } from 'vue'
import { selectedNode, options } from '@/entrypoints/ui/state'
import { serializeCSS, extractJSX } from '@/entrypoints/ui/utils'
import Section from '../Section.vue'
import Code from '../Code.vue'
import IconButton from '../IconButton.vue'
import Preview from '../icons/Preview.vue'

const component = shallowRef('')
const componentLink = shallowRef('')
const css = shallowRef('')
const js = shallowRef('')

watchEffect(async () => {
  const node = selectedNode.value

  if (node == null) {
    css.value = ''
    return
  }

  if (node.type === 'FRAME' && node.name.startsWith('🧩')) {
    // TemPad
    const code = node.findChild((n) => n.type === 'TEXT' && n.name === '代码') as TextNode

    if (code) {
      component.value = extractJSX(code.characters)
    }

    const link = node.findChild((n) => n.type === 'TEXT' && n.name === '🔗') as TextNode

    if (link) {
      componentLink.value = (link.hyperlink as HyperlinkTarget).value
    }
  } else {
    component.value = componentLink.value = ''
  }

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
  <Section title="Code" :collapsed="!selectedNode || !(component || css)">
    <Code
      v-if="component"
      class="tp-code-code"
      title="Component"
      lang="js"
      :link="componentLink"
      :code="component"
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
