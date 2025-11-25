<script setup lang="ts" generic="T extends string | number | boolean">
import type { Component } from 'vue'

import { watch } from 'vue'

export interface SegmentedControlOption<T> {
  label: string
  value: T
  icon?: Component
  tooltip?: string
}

const props = defineProps<{
  options: SegmentedControlOption<T>[]
  name?: string
}>()

const model = defineModel<T>()

const name = props.name || `segmented-control-${Math.random().toString(36).slice(2)}`

watch(
  () => props.options,
  (list) => {
    if (model.value == null) {
      return
    }

    if (!list.some((option) => option.value === model.value)) {
      model.value = undefined
    }
  },
  { deep: true }
)
</script>

<template>
  <div class="tp-segmented-control">
    <div
      v-for="option in options"
      :key="String(option.value)"
      class="tp-segmented-control-option"
      @click="model = option.value"
    >
      <input
        type="radio"
        class="tp-segmented-control-input"
        :name="name"
        :id="`${name}-${option.value}`"
        :value="option.value"
        :checked="model === option.value"
        @change="model = option.value"
        :data-tooltip="option.tooltip || option.label"
        data-tooltip-type="text"
      />
      <span v-if="option.icon" class="tp-segmented-control-icon" aria-hidden="true">
        <component class="tp-segmented-control-icon-content" :is="option.icon" />
      </span>
      <label :for="`${name}-${option.value}`" class="tp-segmented-control-label">
        {{ option.label }}
      </label>
    </div>
  </div>
</template>

<style scoped>
.tp-segmented-control {
  --radio-icon-size: 1.5rem;
  display: inline-flex;
  padding: var(--spacer-0);
  border-radius: var(--radius-medium);
  background-color: var(--color-bg-secondary);
}

.tp-segmented-control-option {
  position: relative;
  display: inline-block;
  flex: 1;
}

.tp-segmented-control-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
}

.tp-segmented-control-icon {
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: var(--radio-icon-size);
  padding: var(--spacer-0);
  border-radius: var(--radius-medium);
  background-color: transparent;
}

.tp-segmented-control-icon-content {
  width: var(--radio-icon-size);
  height: var(--radio-icon-size);
}

.tp-segmented-control-input:checked + .tp-segmented-control-icon {
  background-color: var(--color-bg);
  box-shadow: inset 0 0 0 0.0625rem var(--color-border);
}

.tp-segmented-control-input:not(:checked) + .tp-segmented-control-icon {
  --color-icon: var(--color-icon-secondary);
  --color-icon-tertiary: var(--color-icon-secondary);
}

.tp-segmented-control-label {
  position: absolute;
  clip-path: inset(50%);
  margin: -1px;
  border-width: 0;
  padding: 0;
  width: 1px;
  height: 1px;
  overflow: hidden;
  user-select: none;
  white-space: nowrap;
}
</style>
