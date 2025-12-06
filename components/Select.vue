<script setup lang="ts" generic="T extends string">
import { computed, watch } from 'vue'

import Chevron from '@/components/icons/Chevron.vue'
import OptionCheck from '@/components/icons/OptionCheck.vue'

export interface SelectOption<T extends string = string> {
  label: string
  value: T
}

const { placeholder = 'Select…', options = [] } = defineProps<{
  placeholder?: string
  options?: SelectOption<T>[]
}>()

const model = defineModel<T | null | undefined>()

watch(
  () => options,
  (list) => {
    if (model.value == null) {
      return
    }

    if (!list.some((option) => option.value === model.value)) {
      model.value = null
    }
  },
  { deep: true }
)

const isEmpty = computed(() => model.value == null)

const selectedIndex = computed(() => {
  if (model.value == null) {
    return 0
  }

  const index = options.findIndex((option) => option.value === model.value)
  return index >= 0 ? index : 0
})
</script>

<template>
  <select ref="root" class="tp-select" :data-empty="isEmpty" v-model="model">
    <button type="button" class="tp-select-trigger">
      <span class="tp-select-value">
        <span class="tp-select-placeholder">{{ placeholder }}</span>
        <selectedcontent class="tp-select-selected" />
      </span>
      <Chevron class="tp-select-chevron" aria-hidden="true" />
    </button>
    <option
      v-for="{ label, value } in options"
      :key="value"
      class="tp-select-option"
      :value="value"
    >
      <span class="tp-select-option-check" aria-hidden="true">
        <OptionCheck class="tp-select-option-check-icon" />
      </span>
      <span class="tp-select-option-text">{{ label }}</span>
    </option>
  </select>
</template>

<style scoped>
.tp-select {
  appearance: base-select;
  anchor-name: --tp-select-anchor;
  --tp-select-panel-padding-y: 8px;
  --tp-select-trigger-padding-left: 7px;
  --tp-select-option-height: var(--spacer-4);
  --tp-select-selected-index: v-bind(selectedIndex);
  display: inline-flex;
  align-items: stretch;
  width: 100%;
  min-width: 0;
  height: var(--spacer-4);
  border-radius: var(--radius-medium);
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  color: var(--color-text);
  fill: var(--color-icon);
  box-sizing: border-box;
  padding: 0;
  overflow: hidden;
}

.tp-select:focus-visible {
  border-color: var(--color-border-selected);
  outline: 1px solid var(--color-border-selected);
  outline-offset: 0;
}

.tp-select-trigger {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: var(--spacer-1);
  padding-left: var(--tp-select-trigger-padding-left);
  width: 100%;
  height: 100%;
  flex: 1 0 auto;
  border: none;
  background: none;
  color: inherit;
  fill: inherit;
  font: inherit;
  cursor: inherit;
}

.tp-select-value {
  flex: 1 1 auto;
  min-width: 0;
  display: inline-flex;
  align-items: center;
}

.tp-select-placeholder,
.tp-select-selected {
  flex: 1 0 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tp-select-placeholder {
  color: var(--color-text-secondary);
}

.tp-select[data-empty='true'] .tp-select-selected,
.tp-select:not([data-empty='true']) .tp-select-placeholder {
  display: none;
}

.tp-select-selected {
  display: inline-flex;
  align-items: center;
}

.tp-select-selected .tp-select-option-text {
  display: block;
  width: 100%;
}

.tp-select-selected .tp-select-option-check {
  display: none;
}

.tp-select-chevron {
  width: 24px;
  height: 24px;
  margin: -1px;
}

.tp-select::picker-icon {
  display: none;
}

.tp-select::picker(select) {
  appearance: base-select;
  border: none;
}

.tp-select:open::picker(select) {
  position-anchor: --tp-select-anchor;
  top: calc(
    anchor(top) - var(--tp-select-panel-padding-y) - var(--tp-select-option-height) *
      var(--tp-select-selected-index)
  );
  left: calc(anchor(left) - var(--tp-select-trigger-padding-left));
  margin: 0;
  border-radius: var(--radius-large);
  padding: var(--tp-select-panel-padding-y) var(--spacer-2);
  background: var(--color-bg-menu);
  box-shadow: var(--elevation-400-menu-panel);
  min-width: calc(anchor-size(width) + var(--spacer-2) * 2);
  width: max-content;
  max-height: min(320px, 40vh);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  position-try-fallbacks: flip-block;
  z-index: 10;
}

.tp-select-option {
  display: flex;
  align-items: center;
  min-height: var(--tp-select-option-height);
  width: var(--tp-select-width, 100%);
  padding: 0;
  border-radius: var(--radius-medium);
  font: inherit;
  fill: var(--color-icon-menu);
  color: var(--color-text-menu);
}

.tp-select-option:active {
  background-color: transparent;
}

.tp-select-option::checkmark {
  display: none;
}

.tp-select-option-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 var(--spacer-1);
  width: 18px;
  color: inherit;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.tp-select-option-check-icon {
  flex-shrink: 0;
}

.tp-select-option:checked .tp-select-option-check {
  opacity: 1;
}

.tp-select-option-text {
  flex: 1 0 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 8px;
}

.tp-select-option:is(:hover, :focus-visible) {
  background: var(--color-bg-menu-selected);
  color: var(--color-text-menu-onselected);
  fill: var(--color-icon-menu-onselected);
  outline: none;
}
</style>
