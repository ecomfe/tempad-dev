<script setup lang="ts">
import IconButton from './IconButton.vue'
import Minus from './icons/Minus.vue'
import { evaluate } from '@/entrypoints/ui/utils'

import type { Plugin } from '../plugins/src/index'

const emit = defineEmits<{
  imported: [{ code: string; plugin: Plugin; source: string }]
  cancel: []
}>()

const input = useTemplateRef('input')
defineExpose({
  focus() {
    input.value?.focus()
  }
})

function reportValidity(message: string) {
  input.value?.setCustomValidity(message)
  input.value?.reportValidity()
}

function clearValidity() {
  input.value?.setCustomValidity('')
}

const BUILT_IN_SOURCE_RE = /@[a-z\d_-]+/

function getBuiltInPlugin(source: string) {
  return `https://raw.githubusercontent.com/ecomfe/tempad-dev/refs/heads/main/plugins/dist/${source.slice(1)}.js`
}

function validate() {
  const sourceInput = input.value
  if (!sourceInput) {
    return
  }

  if (!source.value) {
    reportValidity('Please enter a source.')
    return false
  }

  if (!BUILT_IN_SOURCE_RE.test(source.value) && !URL.canParse(source.value)) {
    reportValidity('Please enter a valid source.')
    return false
  }

  clearValidity()
  return true
}

const source = shallowRef('')

let fetchingSource: string | null = null
let controller: AbortController | null = null

async function tryImport() {
  if (!validate()) {
    return
  }

  // No changed URL
  if (source.value === fetchingSource) {
    return
  }

  controller?.abort()
  fetchingSource = source.value
  controller = new AbortController()
  const signal = controller.signal
  let code: string | null = null
  let plugin: Plugin | null = null

  try {
    const url = BUILT_IN_SOURCE_RE.test(source.value)
      ? getBuiltInPlugin(source.value)
      : source.value
    code = await (await fetch(url, { signal })).text()
    code =
      'function s(r){return r.toUpperCase().replace(/-/g,"_")}var a={name:"Kong UI",code:{css:{title:"SCSS",lang:"scss",transformVariable({name:r}){return`$kui-${r.toLowerCase()}`}},js:{transformVariable({name:r}){return`\0KUI_${s(r)}\0`}}}};export{a as plugin};'
  } catch (e) {
    reportValidity(`Failed to fetch the URL.`)
    return
  } finally {
    fetchingSource = null
    controller = null
  }

  try {
    plugin = (await evaluate(code)).plugin
  } catch (e) {
    reportValidity(
      `Failed to evaluate the code: ${e instanceof Error ? e.message : 'Unknown error'}`
    )
  }

  if (plugin) {
    emit('imported', { code, plugin, source: source.value })
  }
}
</script>

<template>
  <div class="tp-row tp-row-justify tp-gap-l">
    <input
      ref="input"
      class="tp-plugin-importer-input"
      type="text"
      v-model="source"
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
