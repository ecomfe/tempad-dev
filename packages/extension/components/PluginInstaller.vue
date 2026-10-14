<script setup lang="ts">
import type { PluginData } from '@/composables'

import { isAllowedPluginSource, usePluginInstall } from '@/composables'

import Button from './Button.vue'
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

function validate() {
  const sourceInput = input.value
  if (!sourceInput) {
    return false
  }

  if (!source.value) {
    validity.value = 'Please enter a source.'
    return false
  }

  if (!isAllowedPluginSource(source.value)) {
    validity.value = 'Please enter a valid source.'
    return false
  }

  validity.value = ''
  return true
}

const source = shallowRef('')

async function startImport() {
  if (installing.value) return
  if (!validate()) {
    return
  }

  const src = source.value
  const installed = await install(src)

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
      @keydown.enter="startImport"
    />
    <Button :disabled="installing" @click="startImport">{{
      installing ? 'Installing…' : 'Install'
    }}</Button>
    <IconButton title="Cancel" @click="cancelImport" variant="secondary">
      <Minus />
    </IconButton>
  </div>
</template>

<style scoped>
.tp-plugin-importer-input {
  flex: 1;
}
</style>
