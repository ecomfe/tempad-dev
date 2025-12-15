<script setup lang="ts">
const props = defineProps<{
  type?: 'button' | 'submit' | 'reset'
  variant?: 'normal' | 'secondary'
  toggle?: boolean
  title?: string
}>()

const selected = defineModel<boolean>('selected')

function handleClick() {
  if (props.toggle) {
    selected.value = !selected.value
  }
}
</script>

<template>
  <button
    class="tp-button"
    :class="{
      'tp-button-secondary': variant === 'secondary' && !toggle,
      'tp-button-selected': selected
    }"
    :type="type || 'button'"
    :data-tooltip="title || null"
    :data-tooltip-type="title ? 'text' : null"
    @click="handleClick"
  >
    <slot />
  </button>
</template>

<style scoped>
.tp-button {
  --icon-button-outline-offset: -0.0625rem;
  --icon-button-outline-width: 0.0625rem;
  --icon-button-outline-color: transparent;
  --icon-button-size: 1.5rem;
  --icon-button-icon-size: 1.5rem;
  --icon-button-radius: var(--radius-medium);
  --icon-button-color-bg: transparent;
  --icon-button-icon: var(--color-icon);
  width: var(--icon-button-width, var(--icon-button-size));
  height: var(--icon-button-height, var(--icon-button-size));
  min-width: var(--icon-button-width, var(--icon-button-size));
  padding: 0;
  border-radius: var(--icon-button-radius);
  background: var(--icon-button-color-bg);
  outline: var(--icon-button-outline-color) solid var(--icon-button-outline-width);
  outline-offset: var(--icon-button-outline-offset);
  display: grid;
  color: var(--icon-button-icon);
  transition:
    0.1s fill ease-out,
    0.1s color ease-out;
}

.tp-button-secondary {
  --icon-button-icon: var(--color-icon-secondary);
}

.tp-button:focus-visible {
  --icon-button-outline-color: var(--color-border-selected);
}

.tp-button:hover {
  --icon-button-color-bg: var(--color-bg-transparent-hover);
  --icon-button-icon: var(--color-icon-hover);
}

.tp-button-selected {
  --icon-button-color-bg: var(--color-bg-selected);
  --icon-button-icon: var(--color-icon-brand);
}

.tp-button-selected:hover {
  --icon-button-color-bg: var(--color-bg-selected-secondary);
  --icon-button-icon: var(--color-icon-brand);
}

.tp-button-selected:active {
  --icon-button-color-bg: var(--color-bg-selected);
  --icon-button-icon: var(--color-icon-brand);
}

.tp-button:disabled {
  --icon-button-icon: var(--color-icon-disabled);
  --icon-button-color-bg: transparent;
}

:slotted(.tp-button svg) {
  width: var(--icon-button-size);
  height: var(--icon-button-size);
}
</style>
