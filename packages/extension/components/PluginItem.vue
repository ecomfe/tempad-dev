<script setup lang="ts">
import type { PluginData } from '@/composables'

import IconButton from '@/components/IconButton.vue'
import Check from '@/components/icons/Check.vue'
import Minus from '@/components/icons/Minus.vue'
import Refresh from '@/components/icons/Refresh.vue'
import { usePluginInstall, useToast } from '@/composables'

const props = defineProps<{
  name: string
  source: string
  checked: boolean
}>()

const emit = defineEmits<{
  updated: [pluginData: PluginData]
  change: [checked: boolean]
  remove: []
}>()

const { validity, installing, install, cancel } = usePluginInstall()
const { show } = useToast()

watch(validity, (message) => {
  if (message) {
    show(message)
    validity.value = ''
  }
})

function handleChange(e: Event) {
  emit('change', (e.target as HTMLInputElement).checked)
}

async function handleUpdate() {
  const installed = await install(props.source, true)

  if (installed) {
    emit('updated', installed)
  }
}

function handleRemove() {
  cancel()
  emit('remove')
}
</script>

<template>
  <div class="tp-row tp-row-justify tp-plugin-item">
    <label class="tp-plugin-item-label tp-row tp-gap-l">
      <input
        class="tp-plugin-item-checkbox-input"
        type="checkbox"
        :checked="checked"
        :disabled="installing"
        @change="handleChange"
      />
      <span class="tp-plugin-item-checkbox">
        <span class="tp-plugin-item-checkbox-inner">
          <Check class="tp-plugin-item-checkbox-check" />
        </span>
      </span>
      <span
        class="tp-plugin-item-name"
        :data-tooltip="source || null"
        :data-tooltip-type="source ? 'text' : null"
      >
        {{ name }}
      </span>
    </label>
    <div class="tp-row tp-gap">
      <IconButton
        variant="secondary"
        class="tp-plugin-item-update"
        :class="{ 'tp-plugin-item-updating': installing }"
        title="Update"
        @click="handleUpdate"
      >
        <Refresh :spin="installing" />
      </IconButton>
      <IconButton variant="secondary" title="Remove" @click="handleRemove">
        <Minus />
      </IconButton>
    </div>
  </div>
</template>

<style scoped>
.tp-plugin-item-label {
  flex-grow: 1;
  cursor: default;
}

.tp-plugin-item-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tp-plugin-item-label:not(:hover)
  + .tp-row
  > .tp-plugin-item-update:not(:hover, .tp-plugin-item-updating) {
  display: none;
}

.tp-plugin-item-checkbox-input {
  position: absolute;
  opacity: 0;
}

.tp-plugin-item-checkbox {
  position: relative;
  --fpl-checkbox-outer-size: 1.5rem;
  --fpl-checkbox-inner-size: 1rem;
  --fpl-checkbox-inset: calc((var(--fpl-checkbox-outer-size) - var(--fpl-checkbox-inner-size)) / 2);
  display: block;
  flex-shrink: 0;
  -webkit-user-select: none;
  user-select: none;
  width: var(--fpl-checkbox-inner-size);
  height: var(--fpl-checkbox-inner-size);
}

.tp-plugin-item-checkbox-inner {
  position: absolute;
  inset: 0;
  --checkbox-first-inner-border-color: var(--color-border);
  --checkbox-second-inner-border-color: transparent;
  --checkbox-bg: var(--color-bg-secondary);
  pointer-events: none;
  display: inline-grid;
  place-content: center;
  background: var(--checkbox-bg);
  border: 1px solid var(--checkbox-first-inner-border-color, transparent);
  border-radius: var(--radius-medium);
  box-sizing: border-box;
}

.tp-plugin-item-checkbox-inner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  border: 1px solid var(--checkbox-second-inner-border-color, transparent);
  border-radius: calc(var(--radius-medium) - 1px);
  box-sizing: border-box;
}

.tp-plugin-item-checkbox-check {
  position: relative;
  width: var(--fpl-checkbox-inner-size);
  height: var(--fpl-checkbox-inner-size);
}

.tp-plugin-item-checkbox-input:not(:checked)
  + .tp-plugin-item-checkbox
  .tp-plugin-item-checkbox-check {
  display: none;
}
</style>
