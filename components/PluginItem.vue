<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Check from '@/components/icons/Check.vue'
import Minus from '@/components/icons/Minus.vue'

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
      <input
        class="tp-plugin-checkbox-input"
        type="checkbox"
        :checked="checked"
        @change="handleChange"
      />
      <span class="tp-plugin-checkbox">
        <span class="tp-plugin-checkbox-inner">
          <Check class="tp-plugin-checkbox-check" />
        </span>
      </span>
      {{ name }}
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

body:not([data-fpl-version='ui3']) .tp-plugin-name {
  gap: 8px;
}

.tp-plugin-checkbox-input {
  position: absolute;
  opacity: 0;
}

.tp-plugin-checkbox {
  position: relative;
}

body:not([data-fpl-version='ui3']) .tp-plugin-checkbox {
  display: flex;
  width: 12px;
  height: 12px;
  border-radius: 2px;
  background-color: var(--color-bg, white);
  border: 1px solid var(--color-icon);
  background-clip: padding-box;
}

body:not([data-fpl-version='ui3']) .tp-plugin-checkbox-check {
  fill: #fff;
}

[data-fpl-version='ui3'] .tp-plugin-checkbox {
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

.tp-plugin-checkbox-inner {
  position: absolute;
  inset: 0;
}

body:not([data-fpl-version='ui3']) .tp-plugin-checkbox-inner {
  display: flex;
  justify-content: center;
  align-items: center;
  inset: -1px;
  border-radius: 2px;
  border-color: var(--color-bg-brand);
  background-color: var(--color-bg-brand);
}

[data-fpl-version='ui3'] .tp-plugin-checkbox-inner {
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

[data-fpl-version='ui3'] .tp-plugin-checkbox-inner::before {
  content: '';
  position: absolute;
  inset: 0;
  background: transparent;
  border: 1px solid var(--checkbox-second-inner-border-color, transparent);
  border-radius: calc(var(--radius-medium) - 1px);
  box-sizing: border-box;
}

[data-fpl-version='ui3'] .tp-plugin-checkbox-check {
  position: relative;
  width: var(--fpl-checkbox-inner-size);
  height: var(--fpl-checkbox-inner-size);
}

body:not([data-fpl-version='ui3'])
  .tp-plugin-checkbox-input:not(:checked)
  + .tp-plugin-checkbox
  .tp-plugin-checkbox-inner {
  display: none;
}

[data-fpl-version='ui3']
  .tp-plugin-checkbox-input:not(:checked)
  + .tp-plugin-checkbox
  .tp-plugin-checkbox-check {
  display: none;
}
</style>
