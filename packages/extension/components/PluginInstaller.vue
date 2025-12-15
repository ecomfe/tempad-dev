<script setup lang="ts">
import type { PluginData } from '@/composables'

import { usePluginInstall } from '@/composables'

import IconButton from './IconButton.vue'
import Minus from './icons/Minus.vue'

const emit = defineEmits<{
  installed: [pluginData: PluginData]
  cancel: []
}>()

const input = useTemplateRef('input')
defineExpose({
  focus() {
    input.value?.focus()
  }
})

const { validity, installing, install, cancel } = usePluginInstall()

watch(validity, async (message) => {
  input.value?.setCustomValidity(message)

  await nextTick()
  input.value?.reportValidity()
})

const BUILT_IN_SOURCE_RE = /@[a-z\d_-]+/

function validate() {
  const sourceInput = input.value
  if (!sourceInput) {
    return false
  }

  if (!source.value) {
    validity.value = 'Please enter a source.'
    return false
  }

  if (!BUILT_IN_SOURCE_RE.test(source.value) && !URL.canParse(source.value)) {
    validity.value = 'Please enter a valid source.'
    return false
  }

  validity.value = ''
  return true
}

const source = shallowRef('')

async function startImport() {
  if (!validate()) {
    return
  }

  const src = source.value
  source.value = 'Installing...'

  const installed = await install(src)
  source.value = src

  if (installed) {
    emit('installed', installed)
  }
}

function cancelImport() {
  cancel()
  emit('cancel')
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
      @input="validity = ''"
      @blur="startImport"
      @keydown.enter="startImport"
    />
    <IconButton title="Remove" @click="cancelImport" variant="secondary">
      <Minus />
    </IconButton>
  </div>
</template>

<style scoped>
.tp-plugin-importer-input {
  flex: 1;
}
</style>
