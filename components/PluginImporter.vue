<script setup lang="ts">
import { useToast } from '@/composables'
import SNAPSHOT_PLUGINS from '@/plugins/available-plugins.json'
import { codegen } from '@/utils'

import IconButton from './IconButton.vue'
import Minus from './icons/Minus.vue'

const { show } = useToast()

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

// plugin registry from the latest commit of the main branch
const REGISTRY_URL =
  'https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/plugins/available-plugins.json'

async function getRegisteredPluginSource(source: string, signal?: AbortSignal) {
  const name = source.slice(1)
  let pluginList = null

  try {
    pluginList = (await fetch(cacheBust(REGISTRY_URL), { cache: 'no-cache', signal }).then((res) =>
      res.json()
    )) as {
      name: string
      source: string
    }[]
  } catch (e) {
    pluginList = SNAPSHOT_PLUGINS
  }

  const plugins = Object.fromEntries(pluginList.map(({ name, source }) => [name, source]))

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

function cacheBust(url: string) {
  const result = new URL(url)
  result.searchParams.append('_tempad-dev_t_', String(Date.now()))
  return result.href
}

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
    const url = BUILT_IN_SOURCE_RE.test(src) ? await getRegisteredPluginSource(src, signal) : src
    const response = await fetch(cacheBust(url), { cache: 'no-cache', signal })
    if (response.status !== 200) {
      throw new Error('404: Not Found')
    }
    code = await response.text()

    try {
      const { pluginName } = await codegen({}, null, { useRem: false, rootFontSize: 12 }, code)
      if (!pluginName) {
        setValidity('The plugin name must not be empty.')
      } else {
        show(`Plugin "${pluginName}" installed successfully.`)
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
