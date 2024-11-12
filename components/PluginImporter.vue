<script setup lang="ts">
import availablePlugins from '@/plugins/available-plugins.json'
import { codegen } from '@/utils'

import IconButton from './IconButton.vue'
import Minus from './icons/Minus.vue'

const emit = defineEmits<{
  imported: [{ code: string; pluginName: string; source: string }]
  cancel: []
}>()

const input = useTemplateRef('input')
defineExpose({
  focus() {
    input.value?.focus()
  }
})

function setValidity(message: string) {
  input.value?.setCustomValidity(message)
}

function reportValidity() {
  input.value?.reportValidity()
}

function clearValidity() {
  input.value?.setCustomValidity('')
}

const BUILT_IN_SOURCE_RE = /@[a-z\d_-]+/

const plugins = Object.fromEntries(availablePlugins.map(({ name, source }) => [name, source]))
function getRegisteredPluginSource(source: string) {
  const name = source.slice(1)
  return (
    plugins[name] ??
    `https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/plugins/dist/${name}.js`
  )
}

function validate() {
  const sourceInput = input.value
  if (!sourceInput) {
    return false
  }

  if (!source.value) {
    setValidity('Please enter a source.')
    return false
  }

  if (!BUILT_IN_SOURCE_RE.test(source.value) && !URL.canParse(source.value)) {
    setValidity('Please enter a valid source.')
    return false
  }

  clearValidity()
  return true
}

const source = shallowRef('')
const installing = shallowRef(false)

let fetchingSource: string | null = null
let controller: AbortController | null = null

async function tryImport() {
  if (!validate()) {
    reportValidity()
    return
  }

  const src = source.value

  // No changed URL
  if (src === fetchingSource) {
    return
  }

  controller?.abort()
  fetchingSource = src
  controller = new AbortController()
  const signal = controller.signal
  let code: string | null = null

  installing.value = true
  source.value = 'Installing...'
  try {
    const url = BUILT_IN_SOURCE_RE.test(src) ? getRegisteredPluginSource(src) : src
    const response = await fetch(url, { signal })
    if (response.status !== 200) {
      throw new Error('404: Not Found')
    }
    code = await response.text()

    try {
      const { pluginName } = await codegen({}, { useRem: false, rootFontSize: 12 }, code)
      if (!pluginName) {
        setValidity('The plugin name must not be empty.')
      } else {
        emit('imported', { code, pluginName, source: src })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error'
      setValidity(`Failed to evaluate the code: ${message}`)
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Network error'
    setValidity(`Failed to fetch the script content: ${message}`)
  } finally {
    fetchingSource = null
    controller = null
  }
  installing.value = false
  source.value = src

  await nextTick()
  reportValidity()
}
</script>

<template>
  <div class="tp-row tp-row-justify tp-gap-l">
    <input
      ref="input"
      class="tp-plugin-importer-input"
      type="text"
      v-model="source"
      :disabled="installing"
      @input="clearValidity"
      @blur="tryImport"
      @keydown.enter="tryImport"
    />
    <IconButton title="Remove" @click="emit('cancel')">
      <Minus />
    </IconButton>
  </div>
</template>

<style scoped>
.tp-plugin-importer-input {
  flex: 1;
}
</style>
