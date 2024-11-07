<script setup lang="ts">
import {
  selection,
  selectedNode,
  options,
  selectedTemPadComponent,
  activePlugin
} from '@/entrypoints/ui/state'
import { serializeCSS } from '@/entrypoints/ui/utils'
import Section from '../Section.vue'
import Code from '../Code.vue'
import IconButton from '../IconButton.vue'
import Preview from '../icons/Preview.vue'
import Info from '../icons/Info.vue'

import type { SupportedLang } from '../../plugins/src/index'

type CodeBlock = {
  name: string
  title: string
  code: string
  lang: SupportedLang
}

const componentCode = shallowRef('')
const componentLink = shallowRef('')
const css = shallowRef<CodeBlock | null>(null)
const js = shallowRef<CodeBlock | null>(null)
const extra = shallowRef<CodeBlock[]>([])
const warning = shallowRef('')

const playButtonTitle = computed(() =>
  componentLink.value
    ? 'Open in TemPad Playground'
    : 'The component is produced with older versions of TemPad that does not provide a link to TemPad playground.'
)

watchEffect(async () => {
  const node = selectedNode.value

  if (node == null || selection.value.length > 1) {
    css.value = null
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

  const { css: cssOptions, js: jsOptions, ...rest } = activePlugin.value?.code || {}

  const style = await node.getCSSAsync()

  if (cssOptions === false) {
    css.value = null
  } else {
    const cssCode = serializeCSS(style, serializeOptions, cssOptions)
    if (!cssCode) {
      css.value = null
    } else {
      css.value = {
        name: 'css',
        title: cssOptions?.title ?? 'CSS',
        lang: cssOptions?.lang ?? 'css',
        code: cssCode
      }
    }
  }

  if (jsOptions === false) {
    js.value = null
  } else {
    const jsCode = serializeCSS(style, { ...serializeOptions, toJS: true }, jsOptions)
    if (!jsCode) {
      js.value = null
    } else {
      js.value = {
        name: 'js',
        title: jsOptions?.title ?? 'JS',
        lang: jsOptions?.lang ?? 'js',
        code: jsCode
      }
    }
  }

  extra.value = Object.keys(rest)
    .map((name) => {
      const extraOptions = rest[name]
      if (extraOptions === false) {
        return null
      }

      const code = serializeCSS(style, serializeOptions, extraOptions)
      if (!code) {
        return null
      }
      return {
        name,
        title: extraOptions.title ?? name,
        lang: extraOptions.lang ?? 'css',
        code
      }
    })
    .filter((item): item is CodeBlock => item != null)

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
  <Section :collapsed="!selectedNode || !(componentCode || css)">
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
    <Code v-if="css" class="tp-code-code" :title="css.title" :lang="css.lang" :code="css.code" />
    <Code v-if="js" class="tp-code-code" :title="js.title" :lang="js.lang" :code="js.code" />
  </Section>
</template>

<style scoped>
.tp-code-code {
  margin-bottom: 8px;
}
</style>
