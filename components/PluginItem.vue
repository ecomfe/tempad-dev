<script setup lang="ts">
import IconButton from './IconButton.vue'
import Minus from './icons/Minus.vue'

defineProps<{
  name: string
  source: string
  checked: boolean
}>()

const emit = defineEmits<{
  change: [checked: boolean]
  remove: []
}>()

function handleChange(e: Event) {
  emit('change', (e.target as HTMLInputElement).checked)
}
</script>

<template>
  <div class="tp-row tp-row-justify tp-plugin-item">
    <label
      class="tp-plugin-name tp-row tp-gap-l"
      :data-tooltip="source || null"
      :data-tooltip-type="source ? 'text' : null"
    >
      <input type="checkbox" :checked="checked" @change="handleChange" />{{ name }}
    </label>
    <IconButton title="Remove" @click="emit('remove')">
      <Minus />
    </IconButton>
  </div>
</template>

<style scoped>
.tp-plugin-name {
  cursor: default;
}
</style>
